/** @format */

/**
 * Torrent index search (The Pirate Bay / apibay).
 *
 * TWO SOURCES, ON PURPOSE:
 *   1. apibay JSON  — primary. Structured, 100 results in one request, no HTML parsing.
 *   2. HTML mirror  — fallback. Only 30 results/page, but it survives apibay being
 *      DNS-blocked, and it is the *only* way to page past result 100 (see below).
 *
 * The index returns only an `info_hash`; magnet links are assembled here from that
 * hash plus a fixed tracker list (TRACKERS), because a hash-only magnet has to
 * bootstrap purely over DHT and is far slower to start.
 *
 * Results come back UNSORTED from apibay (dead 0-seeder torrents routinely land in
 * the first rows) and there is no server-side sort parameter, so sorting is applied
 * here over the full result set before it reaches the client.
 */

import { logger } from '@/lib/logger';
import { SEARCH_CATEGORIES, SORT_FIELDS } from '@/lib/torrentSearchConstants';

const API_BASE = process.env.TORRENT_SEARCH_API || 'https://apibay.org';

/** HTML mirrors, tried in order. Override with a comma-separated env var. */
const HTML_MIRRORS = (process.env.TORRENT_SEARCH_MIRRORS || 'https://thepibay.site,https://thepiratebay.org').split(',').map((s) => s.trim()).filter(Boolean);

const FETCH_TIMEOUT_MS = 15_000;

/** Both endpoints reject requests without a browser-shaped User-Agent (HTTP 403). */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Trackers appended to every generated magnet (taken from the index's own magnets). */
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
];

/** Sentinel row the API returns instead of an empty array when nothing matches. */
const NO_RESULTS_ID = '0';
const NO_RESULTS_HASH = '0000000000000000000000000000000000000000';

/** Top-level category codes -> label. Subcategories are `${top + n}`. */
const CATEGORY_GROUPS = {
  100: 'Audio',
  200: 'Video',
  300: 'Applications',
  400: 'Games',
  500: 'Porn',
  600: 'Other',
};

const CATEGORY_NAMES = {
  101: 'Music', 102: 'Audio books', 103: 'Sound clips', 104: 'FLAC', 199: 'Other',
  201: 'Movies', 202: 'Movies DVDR', 203: 'Music videos', 204: 'Movie clips', 205: 'TV shows',
  206: 'Handheld', 207: 'HD Movies', 208: 'HD TV shows', 209: '3D', 299: 'Other',
  301: 'Windows', 302: 'Mac', 303: 'UNIX', 304: 'Handheld', 305: 'iOS', 306: 'Android', 399: 'Other',
  401: 'PC', 402: 'Mac', 403: 'PSx', 404: 'XBOX360', 405: 'Wii', 406: 'Handheld',
  407: 'iOS', 408: 'Android', 499: 'Other',
  501: 'Movies', 502: 'Movies DVDR', 503: 'Pictures', 504: 'Games', 505: 'HD Movies',
  506: 'Movie clips', 599: 'Other',
  601: 'E-books', 602: 'Comics', 603: 'Pictures', 604: 'Covers', 605: 'Physibles', 699: 'Other',
};

// Re-exported for server-side callers; the canonical list lives in the
// import-free constants module so the client bundle can use it too.
export { SEARCH_CATEGORIES, SORT_FIELDS };

function categoryLabel(code) {
  const n = Number(code);
  if (!n) return 'Unknown';
  const group = CATEGORY_GROUPS[Math.floor(n / 100) * 100];
  const name = CATEGORY_NAMES[n];
  if (group && name) return `${group} › ${name}`;
  return group || `Category ${n}`;
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * Build a magnet URI from an info hash.
 * Exported so the API route can rebuild one without re-running a search.
 */
export function buildMagnet(infoHash, name) {
  const hash = String(infoHash || '').trim();
  if (!/^[a-fA-F0-9]{40}$/.test(hash)) return null;

  const trackers = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=${encodeURIComponent(name || hash)}${trackers}`;
}

async function fetchWithTimeout(url, { headers = {}, timeout = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request to ${new URL(url).host} timed out`);
    throw new Error(`Request to ${new URL(url).host} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise one raw row into the shape the frontend consumes.
 *
 * Fields arrive as strings from q.php but as numbers from t.php, and `imdb` is ''
 * in one and null in the other, so everything is coerced rather than passed through.
 */
function normaliseRow(row) {
  const infoHash = String(row.info_hash || '').toUpperCase();
  const name = String(row.name || '');
  const addedSeconds = Number(row.added) || 0;

  return {
    id: String(row.id),
    name,
    infoHash,
    seeders: Number(row.seeders) || 0,
    leechers: Number(row.leechers) || 0,
    size: Number(row.size) || 0,
    sizeLabel: formatSize(row.size),
    files: Number(row.num_files) || 0,
    uploader: row.username || 'anonymous',
    trust: row.status || 'member',
    added: addedSeconds ? new Date(addedSeconds * 1000).toISOString() : null,
    category: Number(row.category) || 0,
    categoryLabel: categoryLabel(row.category),
    imdb: row.imdb || null,
    magnet: buildMagnet(infoHash, name),
  };
}

/** True for the "No results returned" placeholder row. */
function isSentinel(row) {
  return String(row?.id) === NO_RESULTS_ID || String(row?.info_hash) === NO_RESULTS_HASH;
}

function sortResults(rows, sort = 'seeders', order = 'desc') {
  const field = SORT_FIELDS.includes(sort) ? sort : 'seeders';
  const dir = order === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (field === 'name') return a.name.localeCompare(b.name) * dir;
    if (field === 'added') return ((new Date(a.added || 0)).getTime() - (new Date(b.added || 0)).getTime()) * dir;
    const diff = (a[field] - b[field]) * dir;
    // Stable tiebreak: more seeders wins, so equal-size rows aren't ordered arbitrarily.
    return diff !== 0 ? diff : b.seeders - a.seeders;
  });
}

/** Primary source: the JSON API. Returns normalised rows (unsorted). */
async function searchViaApi(query, category) {
  const url = `${API_BASE}/q.php?q=${encodeURIComponent(query)}&cat=${Number(category) || 0}`;
  const res = await fetchWithTimeout(url);

  if (!res.ok) throw new Error(`Search API returned HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // A mirror that doesn't proxy q.php serves its HTML 404 page with HTTP 200.
    throw new Error('Search API returned a non-JSON response');
  }

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Search API returned an unexpected payload');
  if (data.length === 1 && isSentinel(data[0])) return [];

  return data.filter((row) => !isSentinel(row)).map(normaliseRow);
}

/**
 * Fallback source: scrape a mirror's HTML search page.
 *
 * Deliberately parses the magnet + detail link rather than the whole table layout,
 * so it degrades to "fewer fields" instead of "zero results" when the markup shifts.
 * Size/uploaded/uploader live in a free-text `detDesc` cell and are best-effort.
 */
async function searchViaHtml(query, category, page = 1) {
  const cat = Number(category) || 0;
  let lastError;

  for (const mirror of HTML_MIRRORS) {
    try {
      // Mirror URL form: /search/{query}/{page}/{orderBy}/{category}; 99 = order by seeders.
      const url = `${mirror}/search/${encodeURIComponent(query)}/${page}/99/${cat}`;
      const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html,application/xhtml+xml' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      const rows = parseHtmlRows(html);
      if (rows.length) return rows;

      // An empty parse is either a genuine no-match or a layout change; try the next mirror.
      lastError = new Error('no rows parsed');
    } catch (err) {
      lastError = err;
      logger.warn('Torrent search mirror failed', { mirror, error: err.message });
    }
  }

  throw new Error(`All search mirrors failed (last: ${lastError?.message || 'unknown'})`);
}

function parseHtmlRows(html) {
  // Split into <tr> blocks and pull each field out separately. A single combined
  // regex is brittle here: the fields sit in sibling cells in an order that varies
  // between mirrors, and an optional group behind a lazy prefix silently matches
  // empty rather than finding the cell.
  const rows = [];

  for (const block of html.split(/<tr(?:\s[^>]*)?>/i).slice(1)) {
    const magnetMatch = block.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i);
    if (!magnetMatch) continue;

    const hashMatch = magnetMatch[1].match(/btih:([a-fA-F0-9]{40})/i);
    if (!hashMatch) continue;

    const detail = block.match(/<a[^>]+href="[^"]*\/torrent\/(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!detail) continue;

    const name = decodeEntities(stripTags(detail[2])).trim();
    if (!name) continue;

    // "Uploaded 04-30 20:05, Size 2.85 GiB, ULed by <a>user</a>"
    const desc = decodeEntities(stripTags(block.match(/class="detDesc"[^>]*>([\s\S]*?)<\/font>/i)?.[1] || ''));

    // Seeder/leecher counts are the last two right-aligned numeric cells.
    const counts = [...block.matchAll(/<td[^>]*align="right"[^>]*>\s*(\d+)\s*<\/td>/gi)].map((m) => Number(m[1]));

    // Category cell links to /browse/{code}; the last link is the subcategory.
    const browse = [...block.matchAll(/\/browse\/(\d+)/g)].map((m) => Number(m[1]));
    const category = browse.length ? browse[browse.length - 1] : 0;

    const size = parseSizeText(desc);

    rows.push({
      id: String(detail[1]),
      name,
      infoHash: hashMatch[1].toUpperCase(),
      seeders: counts[0] ?? 0,
      leechers: counts[1] ?? 0,
      size,
      sizeLabel: size ? formatSize(size) : '—',
      files: 0,
      uploader: desc.match(/ULed by\s+(\S+)/i)?.[1] || 'anonymous',
      trust: 'member',
      added: parseUploadedText(desc),
      category,
      categoryLabel: category ? categoryLabel(category) : 'Unknown',
      imdb: null,
      // Kept verbatim: it already carries the mirror's own tracker list.
      magnet: decodeEntities(magnetMatch[1]),
    });
  }

  return rows;
}

/**
 * "Uploaded 01-21 2024" (older) or "Uploaded 04-30 20:05" (this year) -> ISO string.
 * Relative forms ("Today", "Y-day") are left as null rather than guessed at.
 */
function parseUploadedText(text) {
  const withYear = text.match(/Uploaded\s+(\d{2})-(\d{2})\s+(\d{4})/i);
  if (withYear) {
    const [, month, day, year] = withYear;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  const thisYear = text.match(/Uploaded\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i);
  if (thisYear) {
    const [, month, day, hour, minute] = thisYear;
    return new Date(Date.UTC(new Date().getUTCFullYear(), Number(month) - 1, Number(day), Number(hour), Number(minute))).toISOString();
  }

  return null;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** "Uploaded 01-21 2024, Size 3.72 GiB, ULed by x" -> bytes. */
function parseSizeText(text) {
  const m = String(text).match(/Size\s+([\d.]+)\s*([KMGT]?)i?B/i);
  if (!m) return 0;
  const exponent = { '': 0, K: 1, M: 2, G: 3, T: 4 }[m[2].toUpperCase()] ?? 0;
  return Math.round(parseFloat(m[1]) * 1024 ** exponent);
}

/**
 * Search the index.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.category=0]  Category code (0 = all)
 * @param {string} [opts.sort='seeders']
 * @param {string} [opts.order='desc']
 * @param {number} [opts.page=1]      Only meaningful for the HTML source
 * @param {boolean} [opts.html=false] Force the HTML mirror (needed to page past 100)
 * @returns {Promise<{results: any[], source: string, degraded: boolean}>}
 */
export async function searchTorrents(query, opts = {}) {
  const { category = 0, sort = 'seeders', order = 'desc', page = 1, html = false } = opts;

  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) throw new Error('Search query must be at least 2 characters');

  // The JSON API has no offset parameter and caps at 100 rows, so anything past
  // page 1 has to come from the paginated HTML mirror.
  const forceHtml = html || page > 1;

  if (!forceHtml) {
    try {
      const results = await searchViaApi(trimmed, category);
      return { results: sortResults(results, sort, order), source: 'api', degraded: false };
    } catch (err) {
      logger.warn('Torrent search API failed, falling back to HTML mirror', { error: err.message });
    }
  }

  const results = await searchViaHtml(trimmed, category, page);
  return { results: sortResults(results, sort, order), source: 'html', degraded: true };
}

/**
 * Fetch the description and file list for one torrent.
 * Only available from the JSON API — the HTML fallback has no equivalent.
 */
export async function getTorrentDetails(id) {
  const torrentId = String(id).replace(/\D/g, '');
  if (!torrentId) throw new Error('Invalid torrent id');

  const [detailRes, filesRes] = await Promise.all([
    fetchWithTimeout(`${API_BASE}/t.php?id=${torrentId}`),
    fetchWithTimeout(`${API_BASE}/f.php?id=${torrentId}`).catch(() => null),
  ]);

  if (!detailRes.ok) throw new Error(`Details API returned HTTP ${detailRes.status}`);

  const detail = await detailRes.json();
  if (!detail || isSentinel(detail)) throw new Error('Torrent not found');

  let files = [];
  if (filesRes?.ok) {
    try {
      const raw = await filesRes.json();
      // f.php wraps both fields in single-element arrays: {name:["a.iso"],size:[123]}
      files = (Array.isArray(raw) ? raw : [])
        .map((f) => ({
          name: Array.isArray(f.name) ? f.name.join('/') : String(f.name || ''),
          size: Number(Array.isArray(f.size) ? f.size[0] : f.size) || 0,
        }))
        .filter((f) => f.name);
    } catch {
      files = [];
    }
  }

  return {
    ...normaliseRow(detail),
    description: detail.descr || '',
    language: detail.language || null,
    files,
  };
}
