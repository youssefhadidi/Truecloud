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
import { stat, readdir, readFile, mkdir } from 'fs/promises';
import { join } from 'node:path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { buildHlsArgs } from '@/lib/ffmpegUtils';

// ─── Job registry ─────────────────────────────────────────────────────────────
// fileHash → { status: 'transcoding'|'done'|'error', progress: 0-100, error?: string }
const jobs = new Map();

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
export async function startHlsJob(fullPath, cacheDir, codecs, hwaccel, durationSecs) {
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

  await mkdir(hlsDir, { recursive: true });

  const outputM3u8 = join(hlsDir, 'index.m3u8');
  const ffmpegArgs = buildHlsArgs(fullPath, outputM3u8, codecs.videoCodec, codecs.audioCodec, hwaccel);

  logger.info('hlsManager: starting HLS transcode', {
    fullPath,
    hlsDir,
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    hwaccel,
  });

  const proc = spawn('ffmpeg', ffmpegArgs, { cwd: hlsDir });
  let stderr = '';

  proc.stderr.on('data', (chunk) => {
    // Keep only the last 8 KB to prevent unbounded memory growth during long transcodes
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

  proc.on('close', (code) => {
    if (code === 0) {
      jobs.set(hash, { status: 'done', progress: 100 });
      logger.info('hlsManager: HLS transcode complete', { fullPath });
    } else {
      const errSnippet = stderr.slice(-800);

      // VAAPI fallback: same pattern as transcodeManager
      if (hwaccel === 'vaapi' && errSnippet.includes('h264_vaapi')) {
        logger.warn('hlsManager: VAAPI encoding failed, retrying with software libx264', { fullPath });
        jobs.delete(hash); // Clear failed job to allow retry

        // Start retry in background without blocking
        startHlsJob(fullPath, cacheDir, codecs, 'none', durationSecs).catch((err) => {
          logger.error('hlsManager: VAAPI fallback retry failed', { fullPath, error: err.message });
          jobs.set(hash, { status: 'error', progress: 0, error: err.message });
        });
        return;
      }

      jobs.set(hash, { status: 'error', progress: 0, error: errSnippet });
      logger.error('hlsManager: HLS transcode failed', {
        fullPath,
        code,
        stderr: errSnippet,
      });
    }

    // Auto-evict from map 2 minutes after completion
    setTimeout(() => jobs.delete(hash), 120_000);
  });

  proc.on('error', (err) => {
    jobs.set(hash, { status: 'error', progress: 0, error: err.message });
    logger.error('hlsManager: ffmpeg spawn error', { fullPath, error: err.message });
    setTimeout(() => jobs.delete(hash), 120_000);
  });

  return { status: 'transcoding', progress: 0 };
}
