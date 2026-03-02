/** @format */

/**
 * Transcode Manager
 *
 * Singleton job registry for on-demand video transcoding.
 * Node.js module caching ensures a single Map is shared across all imports
 * within the same process (stream route, status route, etc.).
 *
 * Supported formats: AVI, MOV, WMV, FLV, TS, M2TS, MTS, MPEG, MPG, VOB, RM, RMVB, M4V, 3GP, 3G2
 * Output: H.264/AAC MP4 with faststart (using VAAPI if available, libx264 fallback)
 */

import { spawn } from 'child_process';
import { stat, rename, mkdir } from 'fs/promises';
import { join } from 'node:path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { buildMkvTranscodeArgs } from '@/lib/ffmpegUtils';

// ─── Job registry ─────────────────────────────────────────────────────────────
// fileHash → { status: 'transcoding'|'done'|'error', progress: 0-100, error?: string }
const jobs = new Map();

// Extensions that need on-demand HLS transcoding
export const TRANSCODE_EXTENSIONS = new Set([
  '.mkv',
  '.avi', '.mov', '.wmv', '.flv',
  '.ts', '.m2ts', '.mts',
  '.mpeg', '.mpg', '.vob',
  '.rm', '.rmvb',
  '.m4v', '.3gp', '.3g2',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getFileHash(fullPath) {
  return createHash('md5').update(fullPath).digest('hex');
}

export function getCachePath(fullPath, cacheDir) {
  const hash = getFileHash(fullPath);
  return { hash, cachePath: join(cacheDir, `${hash}.mp4`) };
}

/**
 * Check if a ready cached MP4 exists and is newer than the source file.
 * Returns the cache path if ready, or null.
 */
export async function isCacheReady(fullPath, cacheDir) {
  const { cachePath } = getCachePath(fullPath, cacheDir);
  try {
    const [srcStat, cacheStat] = await Promise.all([stat(fullPath), stat(cachePath)]);
    return cacheStat.mtime >= srcStat.mtime ? cachePath : null;
  } catch {
    return null;
  }
}

// ─── Job status ───────────────────────────────────────────────────────────────

export function getJobStatus(hash) {
  return jobs.get(hash) ?? { status: 'none', progress: 0 };
}

// ─── Progress parsing ─────────────────────────────────────────────────────────

function parseTimeSeconds(timeStr) {
  // timeStr: "00:01:23.45"
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
}

// ─── Start transcode job ──────────────────────────────────────────────────────

/**
 * Start a background transcode job.
 * Idempotent: if the job is already running or the cache is ready, returns immediately.
 *
 * @param {string} fullPath     Absolute path to source file
 * @param {string} cacheDir     Directory to write cached MP4 into
 * @param {object} codecs       { videoCodec, audioCodec } from probeCodecs()
 * @param {'vaapi'|'none'} hwaccel
 * @param {number|null} durationSecs  Total duration for progress tracking (from getFileDuration)
 * @returns {Promise<{ status: 'transcoding'|'ready'|'error', progress: number }>}
 */
export async function startTranscodeJob(fullPath, cacheDir, codecs, hwaccel, durationSecs) {
  const { hash, cachePath } = getCachePath(fullPath, cacheDir);

  // Already cached
  const ready = await isCacheReady(fullPath, cacheDir);
  if (ready) {
    jobs.delete(hash);
    return { status: 'ready', progress: 100 };
  }

  // Already running or already failed
  const existing = jobs.get(hash);
  if (existing && existing.status === 'transcoding') {
    return { status: 'transcoding', progress: existing.progress };
  }

  // Don't re-attempt jobs that already failed
  if (existing && existing.status === 'error') {
    return { status: 'error', progress: 0, error: existing.error };
  }

  // Mark as started
  jobs.set(hash, { status: 'transcoding', progress: 0 });

  await mkdir(cacheDir, { recursive: true });

  const tmpPath = `${cachePath}.tmp`;
  const ffmpegArgs = buildMkvTranscodeArgs(
    fullPath,
    tmpPath,
    codecs.videoCodec,
    codecs.audioCodec,
    hwaccel,
  );

  logger.info('transcodeManager: starting transcode', {
    fullPath,
    cachePath,
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    hwaccel,
  });

  const proc = spawn('ffmpeg', ffmpegArgs);
  let stderr = '';

  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);

    // Parse progress from "time=HH:MM:SS.ss" in FFmpeg stderr
    const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/g);
    if (match && durationSecs > 0) {
      const lastTime = match[match.length - 1].replace('time=', '');
      const elapsed = parseTimeSeconds(lastTime);
      const progress = Math.min(99, Math.round((elapsed / durationSecs) * 100));
      jobs.set(hash, { status: 'transcoding', progress });
    }
  });

  proc.on('close', async (code) => {
    if (code === 0) {
      try {
        await rename(tmpPath, cachePath);
        jobs.set(hash, { status: 'done', progress: 100 });
        logger.info('transcodeManager: transcode complete', { fullPath });
      } catch (err) {
        jobs.set(hash, { status: 'error', progress: 0, error: err.message });
        logger.error('transcodeManager: rename failed', { fullPath, error: err.message });
      }
    } else {
      const errSnippet = stderr.slice(-800);

      // VAAPI fallback: if VAAPI encoding failed, retry with software encoding
      if (hwaccel === 'vaapi' && errSnippet.includes('h264_vaapi')) {
        logger.warn('transcodeManager: VAAPI encoding failed, retrying with software libx264', { fullPath });
        jobs.delete(hash); // Clear the failed job to allow retry

        // Start a new transcode job with software encoding (libx264)
        await startTranscodeJob(fullPath, cacheDir, codecs, 'none', durationSecs);
        return;
      }

      jobs.set(hash, { status: 'error', progress: 0, error: errSnippet });
      logger.error('transcodeManager: transcode failed', {
        fullPath,
        code,
        stderr: errSnippet,
      });
    }
    // Auto-evict from map after 2 minutes (cache file persists)
    setTimeout(() => jobs.delete(hash), 120_000);
  });

  proc.on('error', (err) => {
    jobs.set(hash, { status: 'error', progress: 0, error: err.message });
    logger.error('transcodeManager: ffmpeg spawn error', { fullPath, error: err.message });
    setTimeout(() => jobs.delete(hash), 120_000);
  });

  return { status: 'transcoding', progress: 0 };
}
