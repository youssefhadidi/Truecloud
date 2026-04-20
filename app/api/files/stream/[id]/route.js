/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access, lstat, realpath } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import mime from 'mime-types';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { getFileDuration, probeCodecs, isAudioBrowserCompatible } from '@/lib/ffmpegUtils';
import { nodeToWebStream } from '@/lib/streamUtils';
import { readComponentsConfig } from '@/lib/componentsConfig';
import { readTranscodingConfig } from '@/lib/transcodingConfig';
import { isCacheReady } from '@/lib/transcodeManager';
import { startHlsJob, markNative, isMarkedNative } from '@/lib/hlsManager';
import { Semaphore } from '@/lib/semaphore.mjs';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Limit concurrent ffprobe invocations. Each probe spawns 2 processes (codecs +
// duration) each holding 3 pipe FDs. Without a cap, rapid media viewer scrolling
// exhausts the OS FD limit and causes ECONNREFUSED for every subsequent request.
const probeSemaphore = new Semaphore(3);

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const { error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/stream - Processing', { fileId, path: relativePath });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/stream - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);

    // Verify file exists
    try {
      await access(fullPath);
    } catch {
      logger.warn('GET /api/files/stream - File not found', { fullPath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Debug: Check if file is a symlink
    try {
      const linkStats = await lstat(fullPath);
      logger.debug('GET /api/files/stream - File symlink check', {
        fullPath,
        isSymlink: linkStats.isSymbolicLink(),
        lstatSize: linkStats.size
      });

      if (linkStats.isSymbolicLink()) {
        const realPath = await realpath(fullPath);
        const realStats = await stat(realPath);
        logger.info('GET /api/files/stream - File is a symlink', {
          originalPath: fullPath,
          realPath,
          lstatSize: linkStats.size,
          realstatSize: realStats.size
        });
      }
    } catch (err) {
      logger.warn('GET /api/files/stream - Error checking symlink', {
        fullPath,
        error: err.message
      });
    }

    let streamPath = fullPath;
    const fileExt = extname(fileId).toLowerCase();

    // On-demand HLS transcoding for all video formats
    if (VIDEO_EXTENSIONS_SET.has(fileExt)) {
      const components = await readComponentsConfig();

      if (components.transcoding) {
        // Fast path: already confirmed natively streamable on a previous request — skip probing
        if (await isMarkedNative(fullPath)) {
          logger.debug('GET /api/files/stream - Native MP4 (cached), serving directly', { fileId });
        } else {
          // Backward compat: serve existing MP4 cache directly
          const cachedMp4 = await isCacheReady(fullPath, cacheDir);
          if (cachedMp4) {
            streamPath = cachedMp4;
            logger.debug('GET /api/files/stream - Using transcoded MP4 cache', { fileId });
          } else {
            // Short-circuit if the client already navigated away before we start
            // the expensive ffprobe work — prevents FD exhaustion from rapid scrolling.
            if (req.signal?.aborted) {
              return new NextResponse(null, { status: 499 });
            }

            // Start HLS job in background (non-blocking)
            // Debug: Log file stats and probing info
            logger.info('GET /api/files/stream - Before HLS probing', {
              fullPath,
              fileId,
              fileExists: true,
              uploadDir: UPLOAD_DIR,
              relativePath
            });

            // Hardware transcoding is explicitly enabled in admin — use VAAPI.
            // HWACCEL=none env var is the only escape hatch to force software encoding.
            const hwaccel = process.env.HWACCEL?.toLowerCase() === 'none' ? 'none' : 'vaapi';

            // Acquire the probe semaphore: at most 3 concurrent ffprobe pairs can run
            // at the same time. Requests beyond that wait in queue rather than spawning
            // unlimited subprocesses. Pass req.signal so waiting requests are cancelled
            // immediately if the client disconnects while queued.
            try {
              await probeSemaphore.acquire(1, req.signal);
            } catch (err) {
              if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
              throw err;
            }
            let codecs, durationSecs, transcodingConfig;
            try {
              // Check again after waiting for the semaphore — client may have left
              if (req.signal?.aborted) {
                return new NextResponse(null, { status: 499 });
              }

              [codecs, durationSecs, transcodingConfig] = await Promise.all([
                probeCodecs(fullPath, req.signal).catch((err) => {
                  if (err.name !== 'AbortError') {
                    logger.warn('GET /api/files/stream - probeCodecs failed', { fullPath, error: err.message });
                  }
                  return { videoCodec: null, audioCodec: null };
                }),
                getFileDuration(fullPath, req.signal),
                readTranscodingConfig(),
              ]);
            } finally {
              probeSemaphore.release();
            }

            // If the client disconnected while we were probing, don't start ffmpeg
            if (req.signal?.aborted) {
              return new NextResponse(null, { status: 499 });
            }

            logger.info('GET /api/files/stream - Probing complete', {
              fullPath,
              videoCodec: codecs?.videoCodec,
              audioCodec: codecs?.audioCodec,
              hwaccel,
              durationSecs,
              maxHeight: transcodingConfig.maxHeight ?? 'original',
            });

            // H.264 + browser-compatible audio in a natively playable container → serve
            // directly without HLS transcoding.
            // Note: MKV is supported by Chrome but not Firefox/Safari.
            if ((fileExt === '.mp4' || fileExt === '.m4v' || fileExt === '.mkv' || fileExt === '.mov') &&
                codecs.videoCodec === 'h264' &&
                isAudioBrowserCompatible(codecs.audioCodec)) {
              await markNative(fullPath);
              logger.info('GET /api/files/stream - Native video detected, serving directly', { fileId, ext: fileExt });
              // Fall through to byte-range serving
            } else {
              const job = await startHlsJob(fullPath, cacheDir, codecs, hwaccel, durationSecs, { maxHeight: transcodingConfig.maxHeight });

              if (job.status === 'transcoding') {
                logger.info('GET /api/files/stream - HLS transcoding in progress', {
                  fileId,
                  progress: job.progress,
                });
                return NextResponse.json(
                  {
                    error: 'Video is being transcoded for playback. Please try again shortly.',
                    status: 'transcoding',
                    progress: job.progress,
                  },
                  { status: 202 },
                );
              }

              if (job.status === 'done') {
                const hlsParams = new URLSearchParams({ path: relativePath });
                const hlsUrl = `/api/files/hls/${encodeURIComponent(fileId)}?${hlsParams}`;
                logger.info('GET /api/files/stream - HLS ready, returning hlsUrl', { fileId });
                return NextResponse.json({ status: 'ready', hlsUrl });
              }

              if (job.status === 'error') {
                logger.warn('GET /api/files/stream - HLS transcode failed, serving original', { fileId });
                // Fall through to serve original file as best-effort
              }
            }
          }
        }
      }
      // If transcoding disabled: fall through and serve the original file as-is
    }

    const fileStats = await stat(streamPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(streamPath) || 'application/octet-stream';

    // Parse range header
    const range = req.headers.get('range');

    if (!range) {
      // No range, send entire file
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/stream - Streaming full file', { fileId, duration: `${duration}ms` });
      return new NextResponse(nodeToWebStream(fs.createReadStream(streamPath)), {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    // Parse range and clamp to valid bounds
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const end = Math.min(
      parts[1] ? parseInt(parts[1], 10) : fileSize - 1,
      fileSize - 1
    );

    // Reject unsatisfiable ranges (includes 0-byte files with any range request)
    if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;

    // Stream file chunk
    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/stream - Streaming range', {
      fileId,
      range: `${start}-${end}/${fileSize}`,
      chunkSize,
      duration: `${duration}ms`,
    });

    return new NextResponse(nodeToWebStream(fs.createReadStream(streamPath, { start, end, highWaterMark: 256 * 1024 })), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mimeType,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/stream - Error', { error: error.message, duration: `${duration}ms` });
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
  }
}
