/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access, lstat, realpath } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import mime from 'mime-types';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { checkMoovAtom, fixMp4ForStreaming, getFileDuration, probeCodecs, detectHardwareAccel } from '@/lib/ffmpegUtils';
import { readComponentsConfig } from '@/lib/componentsConfig';
import { TRANSCODE_EXTENSIONS, isCacheReady } from '@/lib/transcodeManager';
import { startHlsJob } from '@/lib/hlsManager';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Track in-progress fixes to avoid duplicate work
const inProgressFixes = new Map();

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

    // Check if it's an MP4 that might need fixing for streaming
    if (fileExt === '.mp4') {
      const pathHash = createHash('md5').update(fullPath).digest('hex');
      const cachedPath = join(cacheDir, `${pathHash}.mp4`);

      // Check if we already have a fixed version cached
      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(fullPath), stat(cachedPath)]);

        // Use cache if it's newer than source
        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
          logger.debug('GET /api/files/stream - Using cached fixed MP4', { fileId });
        }
      } catch {
        // Cache doesn't exist
      }

      // If not using cache, check if file needs fixing
      if (!useCache) {
        const hasMoovAtStart = await checkMoovAtom(fullPath);

        if (!hasMoovAtStart) {
          logger.info('GET /api/files/stream - MP4 needs moov atom fix', { fileId });

          // Check if fix is already in progress
          if (!inProgressFixes.has(pathHash)) {
            // Start background fix - don't wait for it
            inProgressFixes.set(pathHash, true);

            // Create cache directory and fix in background
            fs.promises.mkdir(cacheDir, { recursive: true }).then(() => {
              fixMp4ForStreaming(fullPath, cachedPath)
                .then(() => {
                  logger.info('GET /api/files/stream - Background MP4 fix complete', { fileId });
                })
                .catch((err) => {
                  logger.error('GET /api/files/stream - Background MP4 fix failed', { fileId, error: err.message });
                })
                .finally(() => {
                  inProgressFixes.delete(pathHash);
                });
            });

            logger.info('GET /api/files/stream - Started background fix, streaming original', { fileId });
          } else {
            logger.debug('GET /api/files/stream - Fix already in progress, streaming original', { fileId });
          }
          // Stream original file immediately (may buffer more but no wait)
        }
      }
    }

    // On-demand HLS transcoding for non-streamable formats (MKV, AVI, MOV, WMV, FLV, TS, etc.)
    if (TRANSCODE_EXTENSIONS.has(fileExt)) {
      const components = await readComponentsConfig();

      if (components.transcoding) {
        // Backward compat: serve existing MP4 cache directly
        const cachedMp4 = await isCacheReady(fullPath, cacheDir);
        if (cachedMp4) {
          streamPath = cachedMp4;
          logger.debug('GET /api/files/stream - Using transcoded MP4 cache', { fileId });
        } else {
          // Start HLS job in background (non-blocking)
          // Debug: Log file stats and probing info
          logger.info('GET /api/files/stream - Before HLS probing', {
            fullPath,
            fileId,
            fileExists: true,
            uploadDir: UPLOAD_DIR,
            relativePath
          });

          const [codecs, hwaccel, durationSecs] = await Promise.all([
            probeCodecs(fullPath).catch((err) => {
              logger.warn('GET /api/files/stream - probeCodecs failed', { fullPath, error: err.message });
              return { videoCodec: null, audioCodec: null };
            }),
            detectHardwareAccel(),
            getFileDuration(fullPath),
          ]);

          logger.info('GET /api/files/stream - Probing complete', {
            fullPath,
            videoCodec: codecs?.videoCodec,
            audioCodec: codecs?.audioCodec,
            hwaccel,
            durationSecs
          });

          const job = await startHlsJob(fullPath, cacheDir, codecs, hwaccel, durationSecs);

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
      // If transcoding disabled: fall through and serve the original file as-is
    }

    const fileStats = await stat(streamPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(streamPath) || 'application/octet-stream';

    // Parse range header
    const range = req.headers.get('range');

    if (!range) {
      // No range, send entire file
      const fileStream = fs.createReadStream(streamPath);
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/stream - Streaming full file', { fileId, duration: `${duration}ms` });
      return new NextResponse(fileStream, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    // Parse range
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    // Stream file chunk
    const fileStream = fs.createReadStream(streamPath, { start, end });
    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/stream - Streaming range', {
      fileId,
      range: `${start}-${end}/${fileSize}`,
      chunkSize,
      duration: `${duration}ms`,
    });

    return new NextResponse(fileStream, {
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
