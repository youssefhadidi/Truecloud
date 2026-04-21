/** @format */

/**
 * HLS Transcode Manager
 *
 * Singleton job registry for on-demand HLS transcoding.
 * Node.js module caching ensures a single Map is shared across all imports.
 *
 * Output directory: stream-cache/hls/{md5(fullPath)}/
 *   index.m3u8   - HLS playlist (grows as segments are written)
 *   seg000.ts    - first 4-second segment
 *   seg001.ts    - second 4-second segment, etc.
 */

import { spawn } from 'child_process';
import { readdir, readFile, mkdir, writeFile, rename, stat } from 'fs/promises';
import { join, basename, resolve, dirname } from 'node:path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { buildHlsArgs } from '@/lib/ffmpegUtils';
import { createJob, startJob, setJobChild, setJobProgress, addJobLog, completeJob } from '@/lib/jobManager';
import { Semaphore } from '@/lib/semaphore.mjs';

// ─── Encode concurrency cap ───────────────────────────────────────────────────
// Only one HLS ffmpeg job runs at a time. The iGPU has a single VAAPI encode
// engine, so parallel jobs serialize on the hardware anyway — queuing them
// explicitly avoids contention (and, in the software-fallback case, prevents
// two libx264 jobs from fighting for all CPU cores at once).
const hlsEncodeSemaphore = new Semaphore(1);

// ─── Job registry ─────────────────────────────────────────────────────────────
// fileHash → { status: 'transcoding'|'done'|'error', progress: 0-100, error?: string }
const jobs = new Map();

// ─── Native streamable registry ───────────────────────────────────────────────
// Map of file hashes → { size, mtimeMs } for files confirmed natively browser-
// playable (H.264 + compatible audio in MP4, M4V, MOV, or MKV containers).
// Persisted to disk so we don't re-probe every file on server restart.
// Invalidation: on every lookup we stat the file; if size or mtime changed the
// entry is evicted and isMarkedNative returns false (so the stream route
// re-probes).
const nativeMap = new Map();

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';
const NATIVE_REGISTRY_PATH = resolve(process.cwd(), STREAM_CACHE_DIR, 'native-registry.json');

async function loadNativeRegistry() {
  try {
    const raw = await readFile(NATIVE_REGISTRY_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const [hash, meta] of Object.entries(data)) {
      if (meta && typeof meta.size === 'number' && typeof meta.mtimeMs === 'number') {
        nativeMap.set(hash, meta);
      }
    }
    logger.info('hlsManager: loaded native registry', { count: nativeMap.size });
  } catch {
    // File missing or corrupt — start fresh. Not an error.
  }
}

// Debounce writes so bulk markNative calls (e.g. a user scrolling through a
// folder of 50 MP4s on first visit) coalesce into one disk write.
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(NATIVE_REGISTRY_PATH), { recursive: true });
      const tmp = NATIVE_REGISTRY_PATH + '.tmp';
      // Atomic write: JSON goes to .tmp then renames over the target, so a
      // crash mid-write can't corrupt the on-disk file.
      await writeFile(tmp, JSON.stringify(Object.fromEntries(nativeMap)), 'utf8');
      await rename(tmp, NATIVE_REGISTRY_PATH);
    } catch (err) {
      logger.warn('hlsManager: failed to persist native registry', { error: err.message });
    }
  }, 1000);
}

export async function markNative(fullPath) {
  const hash = getHlsHash(fullPath);
  try {
    const s = await stat(fullPath);
    nativeMap.set(hash, { size: s.size, mtimeMs: s.mtimeMs });
    scheduleSave();
  } catch {
    // File vanished between probe and mark — silently skip
  }
}

export async function isMarkedNative(fullPath) {
  const hash = getHlsHash(fullPath);
  const meta = nativeMap.get(hash);
  if (!meta) return false;
  try {
    const s = await stat(fullPath);
    if (s.size === meta.size && s.mtimeMs === meta.mtimeMs) return true;
    // File was modified since last probe — evict and re-probe
    nativeMap.delete(hash);
    scheduleSave();
    return false;
  } catch {
    // File gone — evict
    nativeMap.delete(hash);
    scheduleSave();
    return false;
  }
}

// Fire once at module load; subsequent calls see the hydrated map.
loadNativeRegistry();

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getHlsHash(fullPath) {
  return createHash('md5').update(fullPath).digest('hex');
}

export function getHlsOutputDir(fullPath, cacheDir) {
  const hash = getHlsHash(fullPath);
  return { hash, hlsDir: join(cacheDir, 'hls', hash) };
}

/**
 * Check whether the HLS transcode is fully complete.
 * "Complete" means the manifest exists AND contains #EXT-X-ENDLIST.
 * Returns the path to index.m3u8 if complete, null otherwise.
 */
export async function isHlsCacheComplete(fullPath, cacheDir) {
  const { hlsDir } = getHlsOutputDir(fullPath, cacheDir);
  const m3u8Path = join(hlsDir, 'index.m3u8');
  try {
    const content = await readFile(m3u8Path, 'utf8');
    return content.includes('#EXT-X-ENDLIST') ? m3u8Path : null;
  } catch {
    return null;
  }
}

/**
 * Count how many .ts segment files exist in the output directory.
 * Returns 0 if the directory doesn't exist yet.
 */
export async function getHlsSegmentCount(fullPath, cacheDir) {
  const { hlsDir } = getHlsOutputDir(fullPath, cacheDir);
  try {
    const entries = await readdir(hlsDir);
    return entries.filter((f) => f.endsWith('.ts')).length;
  } catch {
    return 0;
  }
}

// ─── Job status ───────────────────────────────────────────────────────────────

export function getHlsJobStatus(hash) {
  return jobs.get(hash) ?? { status: 'none', progress: 0 };
}

// ─── VOD manifest pre-write ───────────────────────────────────────────────────

const HLS_SEG_DURATION = 4; // must match -hls_time in buildHlsArgs

/**
 * Write a complete VOD playlist before FFmpeg starts so hls.js sees the full
 * duration immediately instead of watching the seek bar grow segment by segment.
 * The file is named playlist.m3u8 (not index.m3u8) so FFmpeg's own manifest
 * doesn't overwrite it.
 */
async function prewriteVodManifest(hlsDir, durationSecs) {
  if (!durationSecs || durationSecs <= 0) return;

  const numSegments = Math.ceil(durationSecs / HLS_SEG_DURATION);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${HLS_SEG_DURATION + 1}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (let i = 0; i < numSegments; i++) {
    const remaining = durationSecs - i * HLS_SEG_DURATION;
    const segDur = Math.min(HLS_SEG_DURATION, remaining);
    lines.push(`#EXTINF:${segDur.toFixed(6)},`);
    lines.push(`seg${String(i).padStart(3, '0')}.ts`);
  }

  lines.push('#EXT-X-ENDLIST');
  await writeFile(join(hlsDir, 'playlist.m3u8'), lines.join('\n') + '\n', 'utf8');
}

// ─── Progress parsing ─────────────────────────────────────────────────────────

function parseTimeSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
}

// ─── Start HLS job ────────────────────────────────────────────────────────────

/**
 * Start a background HLS transcode job.
 * Idempotent: if the job is already running or complete, returns immediately.
 *
 * @param {string} fullPath       Absolute path to source file
 * @param {string} cacheDir       Base cache directory (stream-cache)
 * @param {object} codecs         { videoCodec, audioCodec } from probeCodecs()
 * @param {'vaapi'|'none'} hwaccel
 * @param {number|null} durationSecs  Total duration for progress tracking
 * @returns {Promise<{ status: 'transcoding'|'done'|'error', progress: number }>}
 */
export async function startHlsJob(fullPath, cacheDir, codecs, hwaccel, durationSecs, { maxHeight, _reuseJobId } = {}) {
  const { hash, hlsDir } = getHlsOutputDir(fullPath, cacheDir);

  // Already complete on disk
  const complete = await isHlsCacheComplete(fullPath, cacheDir);
  if (complete) {
    jobs.delete(hash);
    return { status: 'done', progress: 100 };
  }

  // Already running
  const existing = jobs.get(hash);
  if (existing && existing.status === 'transcoding') {
    return { status: 'transcoding', progress: existing.progress };
  }

  // Already failed — don't retry
  if (existing && existing.status === 'error') {
    return { status: 'error', progress: 0, error: existing.error };
  }

  // Mark as started
  jobs.set(hash, { status: 'transcoding', progress: 0 });

  // On VAAPI→libx264 fallback we reuse the same jobId so the user sees one job,
  // not a zombie "Running" VAAPI entry beside the real software one.
  const jobId = _reuseJobId ?? createJob(basename(fullPath), 'hls-transcode');
  jobs.get(hash)._jobId = jobId;
  if (!_reuseJobId) startJob(jobId);

  await mkdir(hlsDir, { recursive: true });

  // Pre-write a complete VOD manifest so hls.js sees the full duration immediately.
  // playlist.m3u8 is served by the HLS route; FFmpeg writes its own index.m3u8.
  if (durationSecs) {
    await prewriteVodManifest(hlsDir, durationSecs).catch((err) => {
      logger.warn('hlsManager: failed to pre-write VOD manifest', { fullPath, error: err.message });
    });
  }

  const outputM3u8 = join(hlsDir, 'index.m3u8');
  const ffmpegArgs = buildHlsArgs(fullPath, outputM3u8, codecs.videoCodec, codecs.audioCodec, hwaccel, { maxHeight });

  // Fire-and-forget: acquire the encode slot, spawn ffmpeg, wire listeners.
  // Must not be awaited — the HTTP handler calls startHlsJob and expects it
  // to return quickly so the client can start polling. If the slot is busy,
  // the job sits in the queue with status='transcoding', progress=0 until
  // the current job finishes.
  (async () => {
    if (hlsEncodeSemaphore.count >= hlsEncodeSemaphore.max) {
      logger.info('hlsManager: queued behind active HLS job', { fullPath });
    }
    await hlsEncodeSemaphore.acquire();

    logger.info('hlsManager: starting HLS transcode', {
      fullPath,
      hlsDir,
      videoCodec: codecs.videoCodec,
      audioCodec: codecs.audioCodec,
      hwaccel,
      maxHeight: maxHeight ?? 'original',
      ffmpegArgs: ffmpegArgs.join(' '),
    });

    // Release must happen exactly once. Guard against 'error' and 'close'
    // both firing (which Node.js can do in some spawn-failure sequences).
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      hlsEncodeSemaphore.release();
    };

    try {
      const proc = spawn('ffmpeg', ffmpegArgs, { cwd: hlsDir });
      setJobChild(jobId, proc);
      let stderr = '';
      let lastBroadcastProgress = -1;

      proc.stderr.on('data', (chunk) => {
        // Keep only the last 8 KB to prevent unbounded memory growth during long transcodes
        stderr = (stderr + chunk.toString()).slice(-8192);

        // Parse progress from "time=HH:MM:SS.ss" in FFmpeg stderr
        const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/g);
        if (match && durationSecs > 0) {
          const lastTime = match[match.length - 1].replace('time=', '');
          const elapsed = parseTimeSeconds(lastTime);
          const progress = Math.min(99, Math.round((elapsed / durationSecs) * 100));
          jobs.set(hash, { ...jobs.get(hash), status: 'transcoding', progress });
          // Broadcast every 5% to avoid flooding
          if (progress >= lastBroadcastProgress + 5) {
            lastBroadcastProgress = progress;
            setJobProgress(jobId, progress, true);
          }
        }
      });

      proc.on('close', (code) => {
        // Release BEFORE firing the VAAPI→libx264 fallback: the retry goes
        // through startHlsJob which re-acquires the semaphore. Holding it
        // here would deadlock on ourselves.
        release();

        if (code === 0) {
          jobs.set(hash, { status: 'done', progress: 100 });
          logger.info('hlsManager: HLS transcode complete', { fullPath });
          completeJob(jobId, true);
        } else {
          const errSnippet = stderr.slice(-800);

          // VAAPI fallback: any VAAPI failure (device not found, init error, encode error, etc.)
          if (hwaccel === 'vaapi') {
            logger.warn('hlsManager: VAAPI failed, retrying with software libx264', {
              fullPath,
              stderr: errSnippet,
            });
            addJobLog(jobId, 'VAAPI failed, retrying with software libx264', 'warn');
            jobs.delete(hash); // Clear failed job to allow retry

            // Start retry in background without blocking. Reuse the current
            // jobId so the user sees a single continuous job rather than a
            // zombie VAAPI job beside the libx264 retry.
            startHlsJob(fullPath, cacheDir, codecs, 'none', durationSecs, { maxHeight, _reuseJobId: jobId }).catch((err) => {
              logger.error('hlsManager: software fallback failed', { fullPath, error: err.message });
              jobs.set(hash, { status: 'error', progress: 0, error: err.message });
              completeJob(jobId, false, err.message);
            });
            return;
          }

          jobs.set(hash, { status: 'error', progress: 0, error: errSnippet });
          logger.error('hlsManager: HLS transcode failed', {
            fullPath,
            code,
            stderr: errSnippet,
          });
          completeJob(jobId, false, errSnippet.slice(-200));
        }

        // Auto-evict from map 2 minutes after completion
        setTimeout(() => jobs.delete(hash), 120_000);
      });

      proc.on('error', (err) => {
        release();
        jobs.set(hash, { status: 'error', progress: 0, error: err.message });
        logger.error('hlsManager: ffmpeg spawn error', { fullPath, error: err.message });
        completeJob(jobId, false, err.message);
        setTimeout(() => jobs.delete(hash), 120_000);
      });
    } catch (err) {
      // Defensive: if spawn() throws synchronously (rare), release and fail.
      release();
      logger.error('hlsManager: failed to start ffmpeg', { fullPath, error: err.message });
      jobs.set(hash, { status: 'error', progress: 0, error: err.message });
      completeJob(jobId, false, err.message);
      setTimeout(() => jobs.delete(hash), 120_000);
    }
  })();

  return { status: 'transcoding', progress: 0 };
}
