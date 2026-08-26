/** @format */

/**
 * Per-client DNS category report, read straight out of FTL's long-term
 * database.
 *
 * Why SQLite and not the REST API: /api/queries returns individual rows and
 * caps at 1000 per call, so aggregating a week of traffic through it would be
 * hundreds of round trips. Grouping in SQL instead bounds the result by the
 * number of distinct (client, domain) pairs — a few thousand on a home
 * network — regardless of how many queries those represent.
 *
 * This module persists nothing. FTL already retains queries for
 * `database.maxDBdays` (91 by default) whether or not this page exists; the
 * report is aggregated in memory per request and thrown away, so it adds no
 * new retention and no new stored history.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { PiholeError } from '@/lib/pihole';
import { categorize, CATEGORY_KEYS, NOISE_CATEGORIES, getOverlayMeta } from '@/lib/dnsCategories';
import { loadCategoryOverlay } from '@/lib/dnsCategoryOverlay';

const execFileAsync = promisify(execFile);

export const FTL_DB_PATH = '/etc/pihole/pihole-FTL.db';

const QUERY_TIMEOUT_MS = 60_000;
// A week of a busy household still groups down to a few thousand rows; the cap
// is a guard against a pathological log, not an expected limit.
const MAX_ROWS = 200_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * FTL status codes that mean "this lookup was blocked". Taken from FTL's
 * enum_status: 1 gravity, 4 regex, 5 denylist, 6-8 external, 9-11 the CNAME
 * variants of gravity/regex/denylist, 16 special domain. 2/3 are
 * forwarded/cached, 12-14 are retries, 15 is a database-busy marker.
 */
const BLOCKED_STATUS = [1, 4, 5, 6, 7, 8, 9, 10, 11, 16];

/**
 * Group by (client, domain) so the row count tracks distinct names, not query
 * volume. `queries` is a view in FTL v6 that resolves the normalised
 * domain/client id tables back to text, and a plain table in v5 — selecting
 * from it works on both.
 *
 * The cutoff is interpolated rather than bound: the sqlite3 CLI treats every
 * argument after the filename as another SQL statement to run, so there is no
 * positional-parameter form to use here. `since` is derived from Date.now()
 * and re-validated as an integer below, so nothing user-supplied reaches the
 * statement.
 */
function buildSql(since) {
  const cutoff = Math.floor(Number(since));
  if (!Number.isSafeInteger(cutoff) || cutoff < 0) {
    throw new PiholeError('Invalid report window.', { status: 400 });
  }

  return `
SELECT client,
       domain,
       COUNT(*) AS hits,
       SUM(CASE WHEN status IN (${BLOCKED_STATUS.join(',')}) THEN 1 ELSE 0 END) AS blocked,
       MAX(timestamp) AS last_seen
FROM queries
WHERE timestamp >= ${cutoff}
GROUP BY client, domain
ORDER BY hits DESC
LIMIT ${MAX_ROWS};
`.trim();
}

/* ------------------------------------------------------------------ */
/* SQLite invocation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Pi-hole ships an embedded SQLite shell as `pihole-FTL sqlite3`, which is the
 * supported way to read the database — a standalone sqlite3 binary is not a
 * Pi-hole dependency and is often absent. Fall back to it anyway for hosts
 * that do have it.
 */
const SQLITE_CANDIDATES = [
  { cmd: 'pihole-FTL', prefix: ['sqlite3'] },
  { cmd: 'sqlite3', prefix: [] },
];

async function runSqlite(sql) {
  let lastError = null;
  let everRan = false;

  for (const { cmd, prefix } of SQLITE_CANDIDATES) {
    // `-readonly` keeps this off FTL's write path. Older shells reject the
    // flag, so retry without it before moving on to the next binary.
    for (const flags of [['-readonly', '-json'], ['-json']]) {
      try {
        const { stdout } = await execFileAsync(cmd, [...prefix, ...flags, FTL_DB_PATH, sql], {
          timeout: QUERY_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
        });
        return stdout;
      } catch (e) {
        lastError = e;
        // ENOENT means this binary does not exist — try the next candidate
        // rather than the next flag combination.
        if (e.code === 'ENOENT') break;
        // Anything else means the shell ran and rejected the work, so the
        // problem is the database or the statement, not a missing Pi-hole.
        everRan = true;
      }
    }
  }

  const detail = lastError?.stderr?.trim() || lastError?.message || 'unknown error';

  // Only blame the install when nothing was actually executable — otherwise
  // that hint points at the wrong thing entirely.
  const hint = everRan
    ? `The SQLite shell reached ${FTL_DB_PATH} but rejected the query. If this mentions a syntax error it is a bug in Truecloud, not your Pi-hole; a "no such table" points at an unexpected FTL schema version.`
    : `Truecloud reads ${FTL_DB_PATH} directly via "pihole-FTL sqlite3". Check that Pi-hole is installed on this host and that the server process can read that file.`;

  throw new PiholeError(`Could not read the Pi-hole query database: ${detail}`, { status: 502, hint });
}

function parseRows(stdout) {
  const text = String(stdout || '').trim();
  // An empty result set prints nothing rather than "[]".
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new PiholeError('The query database returned output Truecloud could not parse.', {
      status: 502,
      hint: 'The bundled SQLite shell may predate JSON output support.',
    });
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

function emptyTotals() {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
}

/** The overlay is optional; only try to load it once per process. */
let overlayAttempted = false;

/**
 * Build the per-client category breakdown.
 *
 * @param {object}  options
 * @param {number}  options.hours       window to report on, counting back from now
 * @param {number}  options.topDomains  domains to keep per client/category for drill-down
 * @returns {Promise<object>}
 */
export async function getClientCategoryReport({ hours = 24, topDomains = 8 } = {}) {
  const windowHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 91);
  const since = Math.floor(Date.now() / 1000) - windowHours * 3600;

  // Pick up an on-disk category list if the admin has installed one. Attempted
  // once per process rather than once per miss, so the common case of no
  // overlay directory does not re-stat on every request.
  if (!overlayAttempted) {
    overlayAttempted = true;
    await loadCategoryOverlay();
  }

  const rows = parseRows(await runSqlite(buildSql(since)));

  /** @type {Map<string, object>} */
  const clients = new Map();
  const totals = emptyTotals();
  let totalHits = 0;
  let totalBlocked = 0;

  for (const row of rows) {
    const ip = String(row.client || '').trim();
    if (!ip) continue;

    const hits = Number(row.hits) || 0;
    const blocked = Number(row.blocked) || 0;
    const lastSeen = Number(row.last_seen) || 0;
    const { domain, category } = categorize(row.domain);

    totals[category] += hits;
    totalHits += hits;
    totalBlocked += blocked;

    let client = clients.get(ip);
    if (!client) {
      client = {
        ip,
        hits: 0,
        blocked: 0,
        lastSeen: 0,
        categories: emptyTotals(),
        // Per-category domain samples, kept only long enough to build the
        // response — a category count with no example is impossible to sanity
        // check against a false positive.
        samples: new Map(),
      };
      clients.set(ip, client);
    }

    client.hits += hits;
    client.blocked += blocked;
    client.categories[category] += hits;
    if (lastSeen > client.lastSeen) client.lastSeen = lastSeen;

    if (!client.samples.has(category)) client.samples.set(category, []);
    client.samples.get(category).push({
      domain: domain || String(row.domain || ''),
      hits,
      blocked,
      lastSeen,
    });
  }

  const keep = Math.min(Math.max(Number(topDomains) || 8, 1), 50);

  const clientList = [...clients.values()]
    .map((c) => {
      const samples = {};
      for (const [category, list] of c.samples) {
        samples[category] = list.sort((a, b) => b.hits - a.hits).slice(0, keep);
      }
      // Signal traffic only — the interesting-vs-noise split is what makes the
      // table readable, since CDN and telemetry lookups otherwise dominate.
      const signalHits = CATEGORY_KEYS.filter((k) => !NOISE_CATEGORIES.has(k)).reduce(
        (sum, k) => sum + c.categories[k],
        0,
      );
      return {
        ip: c.ip,
        hits: c.hits,
        blocked: c.blocked,
        signalHits,
        lastSeen: c.lastSeen,
        categories: c.categories,
        topDomains: samples,
      };
    })
    .sort((a, b) => b.signalHits - a.signalHits || b.hits - a.hits);

  return {
    windowHours,
    since,
    generatedAt: Math.floor(Date.now() / 1000),
    totals,
    totalHits,
    totalBlocked,
    clientCount: clientList.length,
    distinctPairs: rows.length,
    truncated: rows.length >= MAX_ROWS,
    overlay: getOverlayMeta(),
    clients: clientList,
  };
}
