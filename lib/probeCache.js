/** @format */

/**
 * Persisted ffprobe result cache.
 *
 * WHY THIS EXISTS:
 * ffprobe dominates the cost of opening a video. The status route needs codecs
 * to decide whether a file is natively playable; the stream route needs codecs
 * *and* duration to build the HLS job. They each spawned their own, so a single
 * click cost three ffprobe processes — and repeated the whole thing on the next
 * click, and after every server restart.
 *
 * None of that information changes while the bytes on disk don't, so it is
 * cached here keyed by md5(absolute path) and validated against the file's size
 * and mtime on every read. Replacing a file in place changes at least one of
 * those, which evicts the entry and forces a re-probe.
 *
 * This supersedes the narrower `nativeMap` that used to live in hlsManager:
 * that stored only "this file is natively playable", which is derivable from
 * the codecs stored here via isNativelyPlayable(). One registry, one probe.
 *
 * Entry shape:
 *   { size, mtimeMs, videoCodec, audioCodec, videoHeight, pixFmt, durationSecs }
 */

import { readFile, writeFile, mkdir, rename, stat } from 'fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { probeCodecs, getFileDuration } from '@/lib/ffmpegUtils';

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';
const REGISTRY_PATH = resolve(process.cwd(), STREAM_CACHE_DIR, 'probe-registry.json');

// md5(fullPath) → entry
const cache = new Map();

// md5(fullPath) → in-flight probe promise. Two routes racing on the same file
// (the status poll and the stream request often overlap) would otherwise both
// spawn ffprobe and both write the same answer.
//
// Tradeoff worth knowing: joiners share the first caller's AbortSignal, so if
// that client disconnects mid-probe everyone waiting on it sees the abort. The
// alternative — letting the probe outlive its requester — is what the signal
// plumbing in ffmpegUtils exists to prevent (orphaned ffprobes hold 3 pipe FDs
// each and exhaust the limit under rapid scrolling). An aborted joiner just
// re-probes on its next poll, so the failure is self-healing; a leaked FD is not.
const inFlight = new Map();

function hashPath(fullPath) {
  return createHash('md5').update(fullPath).digest('hex');
}

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry.size === 'number' &&
    typeof entry.mtimeMs === 'number' &&
    'videoCodec' in entry &&
    'audioCodec' in entry
  );
}

async function loadRegistry() {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    for (const [hash, entry] of Object.entries(JSON.parse(raw))) {
      if (isValidEntry(entry)) cache.set(hash, entry);
    }
    logger.info('probeCache: loaded registry', { count: cache.size });
  } catch {
    // Missing or corrupt — start empty. Not an error.
  }
}

// Debounce writes so a burst (a media viewer walking a folder) coalesces into
// one disk write. Same pattern the HLS native registry used.
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(REGISTRY_PATH), { recursive: true });
      const tmp = `${REGISTRY_PATH}.tmp`;
      // Atomic: write to .tmp then rename over the target, so a crash
      // mid-write can't leave a truncated registry behind.
      await writeFile(tmp, JSON.stringify(Object.fromEntries(cache)), 'utf8');
      await rename(tmp, REGISTRY_PATH);
    } catch (err) {
      logger.warn('probeCache: failed to persist registry', { error: err.message });
    }
  }, 1000);
}

// Fire once at module load; callers see the hydrated map.
loadRegistry();

/**
 * Cache-only lookup. Never spawns anything.
 * @returns {Promise<object|null>} The entry, or null on miss / stale / missing file.
 */
export async function peekProbeInfo(fullPath) {
  const hash = hashPath(fullPath);
  const entry = cache.get(hash);
  if (!entry) return null;

  try {
    const st = await stat(fullPath);
    if (st.size === entry.size && st.mtimeMs === entry.mtimeMs) return entry;
    // Modified since we probed it — the codecs may well have changed too.
    cache.delete(hash);
    scheduleSave();
    return null;
  } catch {
    cache.delete(hash);
    scheduleSave();
    return null;
  }
}

/**
 * Probe a file, reusing the cached answer when the file is unchanged.
 *
 * Never rejects on probe failure: an unreadable or exotic file resolves to an
 * entry with null codecs, which every caller already treats as "not natively
 * playable, hand it to ffmpeg and let ffmpeg complain". Aborts do reject, so a
 * disconnected client stops the work behind it.
 *
 * @param {string} fullPath
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} entry
 */
export async function getProbeInfo(fullPath, signal) {
  const cached = await peekProbeInfo(fullPath);
  if (cached) return cached;

  const hash = hashPath(fullPath);

  const existing = inFlight.get(hash);
  if (existing) return existing;

  const work = (async () => {
    // stat before probing: the size/mtime we store must describe the bytes we
    // actually looked at, so read them first and let a concurrent write
    // invalidate the entry on the next peek rather than silently mismatching.
    const st = await stat(fullPath);

    const [codecs, durationSecs] = await Promise.all([
      probeCodecs(fullPath, signal).catch((err) => {
        if (err.name === 'AbortError') throw err;
        logger.warn('probeCache: probeCodecs failed', { fullPath, error: err.message });
        return { videoCodec: null, audioCodec: null, videoHeight: null, pixFmt: null };
      }),
      getFileDuration(fullPath, signal),
    ]);

    const entry = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      videoCodec: codecs.videoCodec ?? null,
      audioCodec: codecs.audioCodec ?? null,
      videoHeight: codecs.videoHeight ?? null,
      pixFmt: codecs.pixFmt ?? null,
      durationSecs: durationSecs ?? null,
    };

    // Only remember an answer we actually learned something from. ffprobe
    // failing for a transient reason — FD pressure, a file still being written
    // — yields an all-null entry, and caching that would pin the file to the
    // transcode path until its mtime happened to change. Returning it uncached
    // gives the caller the same answer it would have had before, and the next
    // request gets a fresh attempt.
    if (entry.videoCodec !== null || entry.audioCodec !== null) {
      cache.set(hash, entry);
      scheduleSave();
    }
    return entry;
  })().finally(() => inFlight.delete(hash));

  inFlight.set(hash, work);
  return work;
}

/** Drop a file's cached probe result. */
export function forgetProbeInfo(fullPath) {
  if (cache.delete(hashPath(fullPath))) scheduleSave();
}
