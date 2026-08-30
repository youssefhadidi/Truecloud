/** @format */

/**
 * Pi-hole v6 REST API client.
 *
 * Pi-hole v6 serves its admin GUI and its REST API from the same embedded
 * webserver inside `pihole-FTL`, so the GUI cannot be switched off without
 * losing the API. Truecloud instead expects that webserver bound to loopback
 * (see the "Hide built-in web UI" action in the settings panel), which keeps
 * the stock GUI off the LAN while this client keeps working.
 *
 * Authentication is session based: POST /api/auth with a password returns a
 * SID that is sent back as the `X-FTL-SID` header. FTL caps the number of
 * concurrent sessions (16 by default), so the SID is cached module-wide and
 * reused rather than minted per request.
 *
 * The authoritative endpoint spec is served by the Pi-hole itself at
 * `<baseUrl>/api/docs` and matches its exact FTL build. Reference docs:
 *   https://docs.pi-hole.net/api/  ·  https://ftl.pi-hole.net/master/docs/
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readPiholeConfig } from '@/lib/piholeConfig';
import { isServiceActive, isServiceEnabled } from '@/lib/systemctl';

const execFileAsync = promisify(execFile);

export const FTL_SERVICE = 'pihole-FTL';

const REQUEST_TIMEOUT_MS = 15_000;
const GRAVITY_TIMEOUT_MS = 10 * 60_000;
// Renew the session a little before FTL expires it, so a long request can't
// race the expiry.
const SESSION_RENEW_MARGIN_MS = 30_000;

/** Error carrying the upstream HTTP status so routes can pass it through. */
export class PiholeError extends Error {
  constructor(message, { status = 502, hint = null } = {}) {
    super(message);
    this.name = 'PiholeError';
    this.status = status;
    this.hint = hint;
  }
}

/* ------------------------------------------------------------------ */
/* Base URL validation                                                */
/* ------------------------------------------------------------------ */

const PRIVATE_V4 =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/;

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '::1' || host === '::') return true;
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  // pi.hole is the name Pi-hole resolves for itself
  if (host === 'pi.hole') return true;

  // Bare hostname with no dots — a LAN machine name, not a public host.
  if (!host.includes('.') && !host.includes(':')) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    // Link-local 169.254.0.0/16 covers cloud metadata endpoints; it is
    // technically private but is never a Pi-hole, so reject it explicitly.
    if (host.startsWith('169.254.')) return false;
    return PRIVATE_V4.test(host);
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (host.includes(':')) return /^(f[cd]|fe[89ab])/.test(host);

  return false;
}

/**
 * The base URL is admin-supplied but fetched server-side by a root process,
 * so restrict it to loopback/LAN targets rather than allowing arbitrary hosts.
 * @returns {string} normalized origin without a trailing slash
 */
export function validateBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new PiholeError(`Invalid Pi-hole URL: ${input}`, { status: 400 });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PiholeError('Pi-hole URL must use http:// or https://', { status: 400 });
  }

  if (!isPrivateHost(url.hostname)) {
    throw new PiholeError(
      `Refusing to connect to "${url.hostname}" — only loopback and private-network addresses are allowed.`,
      { status: 400 },
    );
  }

  return url.origin;
}

/* ------------------------------------------------------------------ */
/* Session handling                                                   */
/* ------------------------------------------------------------------ */

let _session = null; // { sid, origin, expiresAt } — sid may be null when Pi-hole has no password

export function invalidatePiholeSession() {
  _session = null;
}

async function readConnection() {
  const cfg = await readPiholeConfig();
  return { origin: validateBaseUrl(cfg.baseUrl), password: cfg.password };
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function upstreamError(res, body, fallback) {
  const detail = body?.error?.message || body?.error?.key || (typeof body === 'string' ? body : null);
  return new PiholeError(detail || fallback || `Pi-hole returned ${res.status}`, {
    status: res.status === 401 ? 401 : 502,
    hint: body?.error?.hint ?? null,
  });
}

/** Authenticate and cache the SID. Returns the session record. */
async function authenticate({ origin, password }) {
  let res;
  try {
    res = await fetch(`${origin}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password ?? '' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new PiholeError(`Cannot reach Pi-hole at ${origin}: ${e.message}`, { status: 502 });
  }

  const body = await parseBody(res);

  if (res.status === 401) {
    throw new PiholeError('Pi-hole rejected the password. Check the app password in Settings.', {
      status: 401,
    });
  }
  if (!res.ok) throw upstreamError(res, body, 'Pi-hole authentication failed');

  const session = body?.session;
  if (!session?.valid) {
    throw new PiholeError(session?.message || 'Pi-hole authentication failed', { status: 401 });
  }

  const validityMs = Number(session.validity) > 0 ? Number(session.validity) * 1000 : 300_000;
  _session = {
    sid: session.sid ?? null,
    origin,
    expiresAt: Date.now() + Math.max(validityMs - SESSION_RENEW_MARGIN_MS, 10_000),
  };
  return _session;
}

async function getSession(conn, { force = false } = {}) {
  if (
    !force &&
    _session &&
    _session.origin === conn.origin &&
    Date.now() < _session.expiresAt
  ) {
    return _session;
  }
  return authenticate(conn);
}

/**
 * Perform an authenticated API call. Re-authenticates once on a 401 so an
 * expired or FTL-evicted session heals itself instead of surfacing an error.
 *
 * @param {string} path      e.g. '/api/stats/summary'
 * @param {object} [options] { method, body, query, timeout, raw }
 * @returns {Promise<any>} parsed JSON, or the Response when `raw` is set
 */
export async function piholeFetch(path, options = {}) {
  const { method = 'GET', body, query, timeout = REQUEST_TIMEOUT_MS, raw = false } = options;
  const conn = await readConnection();

  const run = async (session) => {
    const url = new URL(`${conn.origin}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const headers = {};
    if (session.sid) headers['X-FTL-SID'] = session.sid;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      return await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new PiholeError(`Pi-hole did not respond within ${Math.round(timeout / 1000)}s`, { status: 504 });
      }
      throw new PiholeError(`Cannot reach Pi-hole at ${conn.origin}: ${e.message}`, { status: 502 });
    }
  };

  let session = await getSession(conn);
  let res = await run(session);

  if (res.status === 401) {
    invalidatePiholeSession();
    session = await getSession(conn, { force: true });
    res = await run(session);
  }

  if (raw) {
    if (!res.ok) throw upstreamError(res, await parseBody(res));
    return res;
  }

  const parsed = await parseBody(res);
  if (!res.ok) throw upstreamError(res, parsed);
  return parsed;
}

/** Drop the SID on the Pi-hole side too. Best effort. */
export async function piholeLogout() {
  if (!_session?.sid) {
    invalidatePiholeSession();
    return;
  }
  try {
    await piholeFetch('/api/auth', { method: 'DELETE' });
  } catch {}
  invalidatePiholeSession();
}

/* ------------------------------------------------------------------ */
/* Install + service detection                                        */
/* ------------------------------------------------------------------ */

async function commandExists(cmd) {
  try {
    await execFileAsync('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

export async function isPiholeInstalled() {
  return commandExists('pihole');
}

export async function getServiceStatus() {
  const [active, enabled] = await Promise.all([
    isServiceActive(FTL_SERVICE),
    isServiceEnabled(FTL_SERVICE),
  ]);
  return { active, enabled };
}

/* ------------------------------------------------------------------ */
/* Aggregate status                                                   */
/* ------------------------------------------------------------------ */

/**
 * Everything the admin page needs to render its header, degrading one field
 * at a time. A missing binary, a stopped service and a failed login are three
 * different states the UI must tell apart, so none of them throws here.
 */
export async function getStatus() {
  const cfg = await readPiholeConfig();
  const [installed, service] = await Promise.all([isPiholeInstalled(), getServiceStatus()]);

  const status = {
    installed,
    service,
    connection: { baseUrl: cfg.baseUrl, hasPassword: Boolean(cfg.password), ok: false, error: null },
    version: null,
    blocking: null,
    summary: null,
  };

  if (!installed || !service.active) return status;

  try {
    const [version, blocking, summary] = await Promise.all([getVersion(), getBlocking(), getSummary()]);
    status.connection.ok = true;
    status.version = version;
    status.blocking = blocking;
    status.summary = summary;
  } catch (e) {
    status.connection.error = e.message;
  }

  return status;
}

/* ------------------------------------------------------------------ */
/* Info                                                               */
/* ------------------------------------------------------------------ */

export const getFtlInfo = () => piholeFetch('/api/info/ftl');
export const getVersion = () => piholeFetch('/api/info/version');
export const getMessages = () => piholeFetch('/api/info/messages');

/* ------------------------------------------------------------------ */
/* Blocking                                                           */
/* ------------------------------------------------------------------ */

export const getBlocking = () => piholeFetch('/api/dns/blocking');

/**
 * @param {boolean} enabled
 * @param {number|null} timerSeconds revert automatically after this many seconds
 */
export function setBlocking(enabled, timerSeconds = null) {
  if (timerSeconds !== null && timerSeconds !== undefined) {
    if (!Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > 86400) {
      throw new PiholeError('Timer must be a whole number of seconds between 1 and 86400.', { status: 400 });
    }
  }
  return piholeFetch('/api/dns/blocking', {
    method: 'POST',
    body: { blocking: Boolean(enabled), timer: timerSeconds ?? null },
  });
}

/* ------------------------------------------------------------------ */
/* Stats                                                              */
/* ------------------------------------------------------------------ */

export const getSummary = () => piholeFetch('/api/stats/summary');
export const getUpstreams = () => piholeFetch('/api/stats/upstreams');
export const getQueryTypes = () => piholeFetch('/api/stats/query_types');

export const getTopDomains = (blocked = false, count = 10) =>
  piholeFetch('/api/stats/top_domains', { query: { blocked: String(Boolean(blocked)), count } });

export const getTopClients = (blocked = false, count = 10) =>
  piholeFetch('/api/stats/top_clients', { query: { blocked: String(Boolean(blocked)), count } });

/* ------------------------------------------------------------------ */
/* Query log                                                          */
/* ------------------------------------------------------------------ */

export function getQueries({ length = 100, cursor, domain, client, upstream, type, status } = {}) {
  const n = Number(length);
  return piholeFetch('/api/queries', {
    query: {
      length: Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 100,
      cursor,
      domain,
      client,
      upstream,
      type,
      status,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Adlists — addressed by URL, not by id                              */
/* ------------------------------------------------------------------ */

const LIST_TYPES = new Set(['block', 'allow']);

function assertListType(type) {
  if (!LIST_TYPES.has(type)) throw new PiholeError(`Invalid list type: ${type}`, { status: 400 });
}

export function getLists(type = 'block') {
  assertListType(type);
  return piholeFetch('/api/lists', { query: { type } });
}

export function addList(address, { type = 'block', comment = '', enabled = true, groups = [0] } = {}) {
  assertListType(type);
  const url = validateListAddress(address);
  // FTL reads the adlist type from the query string only -- never from the
  // payload -- and rejects every write that omits it with a 400.
  return piholeFetch('/api/lists', {
    method: 'POST',
    query: { type },
    body: { address: url, comment, enabled: Boolean(enabled), groups },
  });
}

export function updateList(address, { type = 'block', comment, enabled, groups } = {}) {
  assertListType(type);
  const url = validateListAddress(address);
  const body = {};
  if (comment !== undefined) body.comment = comment;
  if (enabled !== undefined) body.enabled = Boolean(enabled);
  if (groups !== undefined) body.groups = groups;
  return piholeFetch(`/api/lists/${encodeURIComponent(url)}`, { method: 'PUT', query: { type }, body });
}

export function deleteList(address, type = 'block') {
  assertListType(type);
  const url = validateListAddress(address);
  return piholeFetch(`/api/lists/${encodeURIComponent(url)}`, { method: 'DELETE', query: { type } });
}

/** Adlist sources are fetched by Pi-hole, so only allow sane URL schemes. */
function validateListAddress(address) {
  let url;
  try {
    url = new URL(String(address).trim());
  } catch {
    throw new PiholeError(`Invalid list URL: ${address}`, { status: 400 });
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    throw new PiholeError('List URL must be http://, https:// or file://', { status: 400 });
  }
  return url.href;
}

/* ------------------------------------------------------------------ */
/* Allow / deny domains                                               */
/* ------------------------------------------------------------------ */

const DOMAIN_TYPES = new Set(['allow', 'deny']);
const DOMAIN_KINDS = new Set(['exact', 'regex']);
const EXACT_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function assertDomainSelector(type, kind) {
  if (!DOMAIN_TYPES.has(type)) throw new PiholeError(`Invalid domain type: ${type}`, { status: 400 });
  if (!DOMAIN_KINDS.has(kind)) throw new PiholeError(`Invalid domain kind: ${kind}`, { status: 400 });
}

function validateDomain(domain, kind) {
  const value = String(domain).trim();
  if (!value || value.length > 253) {
    throw new PiholeError('Domain must be between 1 and 253 characters.', { status: 400 });
  }
  if (kind === 'exact') {
    if (!EXACT_DOMAIN_RE.test(value)) {
      throw new PiholeError(`"${value}" is not a valid domain name.`, { status: 400 });
    }
  } else {
    try {
      new RegExp(value);
    } catch (e) {
      throw new PiholeError(`Invalid regular expression: ${e.message}`, { status: 400 });
    }
  }
  return value;
}

export function getDomains(type = 'deny', kind = 'exact') {
  assertDomainSelector(type, kind);
  return piholeFetch(`/api/domains/${type}/${kind}`);
}

export function addDomain(domain, { type = 'deny', kind = 'exact', comment = '', enabled = true, groups = [0] } = {}) {
  assertDomainSelector(type, kind);
  const value = validateDomain(domain, kind);
  return piholeFetch(`/api/domains/${type}/${kind}`, {
    method: 'POST',
    body: { domain: value, comment, enabled: Boolean(enabled), groups },
  });
}

export function deleteDomain(domain, type = 'deny', kind = 'exact') {
  assertDomainSelector(type, kind);
  const value = validateDomain(domain, kind);
  return piholeFetch(`/api/domains/${type}/${kind}/${encodeURIComponent(value)}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

export const getConfig = () => piholeFetch('/api/config');

/**
 * Patch a narrow slice of FTL's config. Callers must pass an already
 * whitelisted object — the API route decides which keys are writable.
 * @param {object} partial e.g. { dns: { dnssec: true } }
 */
export const patchConfig = (partial) => piholeFetch('/api/config', { method: 'PATCH', body: { config: partial } });

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

export const restartDns = () => piholeFetch('/api/action/restartdns', { method: 'POST' });

/**
 * Rebuild gravity. The response streams progress lines as they happen.
 * @param {(line: string) => void} [onLine] called for each non-empty line
 */
export async function runGravity(onLine) {
  const res = await piholeFetch('/api/action/gravity', {
    method: 'POST',
    timeout: GRAVITY_TIMEOUT_MS,
    raw: true,
  });

  if (!res.body) {
    const text = await res.text();
    for (const line of splitLines(text)) onLine?.(line);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      const clean = stripAnsi(line);
      if (clean) onLine?.(clean);
    }
  }

  const tail = stripAnsi(buffer + decoder.decode());
  if (tail) onLine?.(tail);
}

function splitLines(text) {
  return String(text)
    .split('\n')
    .map(stripAnsi)
    .filter(Boolean);
}

/**
 * Pi-hole's tooling writes for a terminal: strip ANSI escapes and carriage
 * returns so job logs stay readable. Shared with the guided installer.
 */
export function stripAnsi(line) {
  return String(line)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .trim();
}
