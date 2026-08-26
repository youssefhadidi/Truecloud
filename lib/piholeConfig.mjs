/** @format */

import fsPromises from 'fs/promises';
import { resolve, dirname } from 'node:path';

const CONFIG_PATH = resolve(process.cwd(), 'config', 'pihole.json');

const DEFAULTS = {
  // Pi-hole v6 serves both its own web UI and the REST API from the same
  // embedded webserver. We point at localhost so the stock GUI can stay
  // unreachable from the LAN while this app keeps API access.
  baseUrl: 'http://127.0.0.1:8080',
  password: '',
};

// In-memory cache (30 second TTL)
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30_000;

export async function readPiholeConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) {
    return _configCache;
  }

  try {
    const raw = await fsPromises.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _configCache = { ...DEFAULTS, ...parsed };
    _configCacheTime = now;
    return _configCache;
  } catch {
    _configCache = { ...DEFAULTS };
    _configCacheTime = now;
    return _configCache;
  }
}

/**
 * Persist the connection settings. Holds a password, so the file is 0600.
 * Omitting `password` (or passing undefined) keeps the stored one — the UI
 * never receives it back, so it cannot echo it on save.
 */
export async function writePiholeConfig(config) {
  const previous = await readPiholeConfig();

  const normalized = {
    baseUrl: String(config?.baseUrl ?? previous.baseUrl).trim().replace(/\/+$/, ''),
    password: config?.password === undefined ? previous.password : String(config.password),
  };

  await fsPromises.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  // writeFile only applies `mode` when creating the file — enforce it either way.
  try {
    await fsPromises.chmod(CONFIG_PATH, 0o600);
  } catch {}

  _configCache = normalized;
  _configCacheTime = Date.now();
  return normalized;
}

/** Shape safe to return to the browser — never includes the password itself. */
export function publicPiholeConfig(config) {
  return {
    baseUrl: config.baseUrl,
    hasPassword: Boolean(config.password),
  };
}

export function invalidatePiholeConfigCache() {
  _configCache = null;
  _configCacheTime = 0;
}
