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
} from '@/lib/ffmpegUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Track in-progress MP4 fixes to avoid duplicate work
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
