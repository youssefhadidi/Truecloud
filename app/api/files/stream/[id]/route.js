/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import mime from 'mime-types';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import {
  checkMoovAtom,
  fixMp4ForStreaming,
  probeCodecs,
  detectHardwareAccel,
  buildMkvTranscodeArgs,
  transcodeToMp4,
} from '@/lib/ffmpegUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Track in-progress fixes to avoid duplicate work
const inProgressFixes = new Map();

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const { session, error } = await requireAuthNoActivity();
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

    let streamPath = fullPath;
    const fileExt = extname(fileId).toLowerCase();

    // Parse optional transcoding parameters from query string
    const maxWidth = url.searchParams.has('maxWidth') ? parseInt(url.searchParams.get('maxWidth'), 10) : undefined;
    const maxHeight = url.searchParams.has('maxHeight') ? parseInt(url.searchParams.get('maxHeight'), 10) : undefined;
    const bitrate = url.searchParams.get('bitrate');

    // Check if it's an MKV file that needs transcoding for browser compatibility
    if (fileExt === '.mkv') {
      // Include resolution/bitrate in cache key so different versions are cached separately
      let cacheKeySuffix = '';
      if (maxWidth || maxHeight || bitrate) {
        const resolutionStr = [maxWidth || 'auto', maxHeight || 'auto', bitrate || 'auto'].join('_');
        cacheKeySuffix = `_${resolutionStr}`;
      }

      const pathHash = createHash('md5').update(fullPath).digest('hex');
      const cachedPath = join(cacheDir, `${pathHash}${cacheKeySuffix}.mp4`);
      const tmpPath = cachedPath + '.tmp';

      // 1. Check cache validity
      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(fullPath), stat(cachedPath)]);
        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
          logger.debug('GET /api/files/stream - Using cached transcoded MP4', { fileId });
        }
      } catch {
        // Cache file does not exist yet
      }

      if (!useCache) {
        if (!inProgressFixes.has(pathHash)) {
          // Store Promise so concurrent requests await the same job
          const transcodePromise = (async () => {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const [{ videoCodec, audioCodec }, hwaccel] = await Promise.all([
              probeCodecs(fullPath),
              detectHardwareAccel(),
            ]);
            logger.info('GET /api/files/stream - MKV codec probe', {
              fileId,
              videoCodec,
              audioCodec,
              hwaccel,
              maxWidth,
              maxHeight,
              bitrate,
            });
            const args = buildMkvTranscodeArgs(fullPath, tmpPath, videoCodec, audioCodec, hwaccel, {
              maxWidth,
              maxHeight,
              bitrate,
            });
            await transcodeToMp4(fullPath, tmpPath, args);
            await fs.promises.rename(tmpPath, cachedPath);
          })();

          inProgressFixes.set(pathHash, transcodePromise);

          try {
            await transcodePromise;
            streamPath = cachedPath;
            logger.info('GET /api/files/stream - MKV transcode complete, serving MP4', { fileId });
          } catch (err) {
            logger.error('GET /api/files/stream - MKV transcode failed', {
              fileId,
              error: err.message,
            });
            inProgressFixes.delete(pathHash);
            throw err; // Fail the request instead of fallback
          }
          inProgressFixes.delete(pathHash);
        } else {
          // Another request is already transcoding — wait for it
          logger.debug('GET /api/files/stream - MKV transcode in progress, waiting', { fileId });
          await inProgressFixes.get(pathHash);
          // Re-check cache after waiting
          const [sourceStats, cachedStats] = await Promise.all([stat(fullPath), stat(cachedPath)]);
          if (cachedStats.mtime >= sourceStats.mtime) {
            streamPath = cachedPath;
          } else {
            throw new Error('MKV transcode failed to produce cached file');
          }
        }
      }
    }
    // Check if it's an MP4 that might need fixing for streaming
    else if (fileExt === '.mp4') {
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
