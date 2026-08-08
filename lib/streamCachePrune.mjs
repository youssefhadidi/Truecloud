/** @format */

/**
 * Stream cache eviction.
 *
 * WHY THIS EXISTS:
 * Every non-native video that gets played leaves behind a full HLS rendition
 * under stream-cache/hls/{hash}/ — effectively a second copy of the file. Until
 * this module there was nothing that ever removed one. The only control was the
 * admin "clear cache" button, which nukes everything indiscriminately (and was
 * pointed at the wrong directory entirely, so in practice nothing was ever
 * reclaimed). A library that gets watched fills the disk.
 *
 * Two independent limits, applied in that order:
 *   1. Age    — anything untouched for STREAM_CACHE_MAX_AGE_DAYS goes.
 *   2. Budget — if what remains still exceeds STREAM_CACHE_MAX_GB, evict
 *               least-recently-used until it fits.
 *
 * WHY NOT CONSULT THE JOB REGISTRY:
 * hlsManager's in-memory `jobs` map would tell us exactly which transcodes are
 * live, but this module is loaded by server.js while hlsManager is loaded by
 * the Next.js bundler — different module instances, different maps. Recency
 * answers the same question without the coupling: ffmpeg writes a segment every
 * few seconds, so any directory an encode is actively filling has an mtime
 * within seconds. Anything untouched for ACTIVE_GRACE_MS is provably not being
 * written to, and a directory left behind by a crashed encode ages out into
 * eviction on its own, which is the behaviour we want anyway.
 */

import { readdir, stat, rm } from 'fs/promises';
import { join, resolve } from 'node:path';

// server.js loads this module directly, outside the Next.js bundler, so the
// '@/' alias is unavailable here. Same reason lib/fileWatcher.mjs inlines one.
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
};

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

const MAX_AGE_DAYS = Number(process.env.STREAM_CACHE_MAX_AGE_DAYS ?? 30);
const MAX_GB = Number(process.env.STREAM_CACHE_MAX_GB ?? 25);
const INTERVAL_HOURS = Number(process.env.STREAM_CACHE_PRUNE_INTERVAL_H ?? 6);

// A directory touched this recently may have an ffmpeg writing into it.
const ACTIVE_GRACE_MS = 15 * 60 * 1000;

// Top-level bookkeeping files that are not cache entries and must survive.
const PRESERVED_FILES = new Set(['native-registry.json', 'probe-registry.json']);

/**
 * Recursively total a directory's byte size and find its most recent access.
 * Returns null if the directory vanished mid-walk (a concurrent prune or an
 * admin "clear cache" — either way, not ours to report on).
 */
async function measure(path) {
  let bytes = 0;
  let recency = 0;

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const sub = await measure(child);
      if (!sub) continue;
      bytes += sub.bytes;
      recency = Math.max(recency, sub.recency);
    } else {
      try {
        const st = await stat(child);
        bytes += st.size;
        recency = Math.max(recency, fileRecency(st));
      } catch {
        // Raced with a delete — skip it.
      }
    }
  }

  return { bytes, recency };
}

/**
 * Best-effort "when was this last useful". atime is the honest signal for an
 * LRU, but most Linux filesystems mount relatime (or noatime), where it barely
 * moves — so take whichever of atime/mtime is later and accept that on a
 * noatime volume this degrades to "least recently *written*".
 */
function fileRecency(st) {
  return Math.max(st.atimeMs || 0, st.mtimeMs || 0);
}

/**
 * Enumerate every evictable cache entry.
 *
 * Three shapes live side by side in this directory:
 *   hls/{hash}/   — HLS renditions (directory)
 *   subs/{hash}/  — extracted WebVTT (directory)
 *   {hash}.mp4    — legacy full-file remuxes (file)
 */
async function collectEntries(cacheDir) {
  const entries = [];

  const addDir = async (path) => {
    const m = await measure(path);
    if (m) entries.push({ path, ...m });
  };

  for (const group of ['hls', 'subs']) {
    const groupDir = join(cacheDir, group);
    let hashes;
    try {
      hashes = await readdir(groupDir, { withFileTypes: true });
    } catch {
      continue; // group never created
    }
    for (const entry of hashes) {
      if (entry.isDirectory()) await addDir(join(groupDir, entry.name));
    }
  }

  let top;
  try {
    top = await readdir(cacheDir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const entry of top) {
    if (entry.isDirectory()) continue; // hls/ and subs/ handled above
    if (PRESERVED_FILES.has(entry.name)) continue;
    const path = join(cacheDir, entry.name);
    try {
      const st = await stat(path);
      entries.push({ path, bytes: st.size, recency: fileRecency(st) });
    } catch {
      // Raced with a delete.
    }
  }

  return entries;
}

/**
 * Run one eviction pass.
 * @returns {Promise<{ deleted: number, freedBytes: number, remainingBytes: number, skippedActive: number }>}
 */
export async function pruneStreamCache() {
  const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const budgetBytes = MAX_GB * 1024 * 1024 * 1024;

  const all = await collectEntries(cacheDir);

  // Anything recently written could be an encode in flight — leave it alone
  // and let the next pass reconsider it.
  const active = all.filter((e) => now - e.recency < ACTIVE_GRACE_MS);
  const candidates = all.filter((e) => now - e.recency >= ACTIVE_GRACE_MS);

  // Oldest first: the age sweep and the budget sweep both want this order.
  candidates.sort((a, b) => a.recency - b.recency);

  let freedBytes = 0;
  let deleted = 0;
  const survivors = [];

  const evict = async (entry) => {
    try {
      await rm(entry.path, { recursive: true, force: true });
      freedBytes += entry.bytes;
      deleted++;
      return true;
    } catch (err) {
      logger.warn('streamCachePrune: failed to remove entry', { path: entry.path, error: err.message });
      return false;
    }
  };

  // Pass 1 — age.
  for (const entry of candidates) {
    if (maxAgeMs > 0 && now - entry.recency > maxAgeMs) {
      if (!(await evict(entry))) survivors.push(entry);
    } else {
      survivors.push(entry);
    }
  }

  // Pass 2 — budget. Active entries count against it (they are real bytes on
  // disk) but can't be evicted, so a single enormous in-flight transcode can
  // legitimately leave us over budget. That is correct: the alternative is
  // deleting the thing someone is watching right now.
  let totalBytes =
    active.reduce((sum, e) => sum + e.bytes, 0) + survivors.reduce((sum, e) => sum + e.bytes, 0);

  if (budgetBytes > 0 && totalBytes > budgetBytes) {
    for (const entry of survivors) {
      if (totalBytes <= budgetBytes) break;
      if (await evict(entry)) totalBytes -= entry.bytes;
    }
  }

  if (deleted > 0) {
    logger.info('streamCachePrune: pass complete', {
      deleted,
      freedMB: Math.round(freedBytes / 1048576),
      remainingMB: Math.round(totalBytes / 1048576),
      skippedActive: active.length,
    });
  }

  return { deleted, freedBytes, remainingBytes: totalBytes, skippedActive: active.length };
}

let timer = null;

/** Start the periodic pruner. Idempotent. */
export function startStreamCachePruner() {
  if (timer) return;

  if (!(MAX_AGE_DAYS > 0) && !(MAX_GB > 0)) {
    logger.info('streamCachePrune: disabled (both limits are zero)');
    return;
  }

  logger.info('streamCachePrune: starting', {
    maxAgeDays: MAX_AGE_DAYS,
    maxGB: MAX_GB,
    intervalHours: INTERVAL_HOURS,
  });

  const run = () => {
    pruneStreamCache().catch((err) =>
      logger.error('streamCachePrune: pass failed', { error: err.message }),
    );
  };

  // A first pass at boot catches whatever accumulated while the server was down.
  run();

  timer = setInterval(run, INTERVAL_HOURS * 60 * 60 * 1000);
  // Don't hold the event loop open on shutdown.
  timer.unref?.();
}

export function stopStreamCachePruner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
