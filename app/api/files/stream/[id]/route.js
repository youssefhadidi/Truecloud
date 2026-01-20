/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import fs from 'fs';
import { stat, access } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import mime from 'mime-types';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = './stream-cache';

// Check if MP4 has moov atom at the beginning (required for streaming)
async function checkMoovAtom(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      // If ffprobe succeeds quickly, moov is likely at the beginning
      // If it takes long or fails, moov might be at the end
      resolve(code === 0);
    });

    // Timeout after 1 second - if it takes this long, moov is likely at the end
    setTimeout(() => {
      ffprobe.kill();
      resolve(false);
    }, 1000);
  });
}

// Fix MP4 for streaming by moving moov atom to beginning
async function fixMp4ForStreaming(inputPath, outputPath) {
  const startTime = Date.now();
  logger.info('Fixing MP4 for streaming', { inputPath, outputPath });

  return new Promise((resolve, reject) => {
    // Use FFmpeg to re-mux the file with moov atom at the beginning
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-c',
      'copy', // Copy streams without re-encoding
      '-movflags',
      'faststart', // Move moov atom to beginning
      '-y', // Overwrite output
      outputPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('MP4 fixed for streaming', { inputPath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('FFmpeg failed to fix MP4', { inputPath, code, duration: `${duration}ms`, errorOutput });
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      const duration = Date.now() - startTime;
      logger.error('FFmpeg spawn error', { inputPath, error: err.message, duration: `${duration}ms` });
      reject(err);
    });
  });
}

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/stream - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const fileId = decodeURIComponent(resolvedParams.id);

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

          // Create cache directory
          await fs.promises.mkdir(cacheDir, { recursive: true });

          // Fix the MP4 for streaming
          try {
            await fixMp4ForStreaming(fullPath, cachedPath);
            streamPath = cachedPath;
            logger.info('GET /api/files/stream - Using fixed MP4', { fileId });
          } catch (err) {
            logger.error('GET /api/files/stream - Failed to fix MP4, using original', { fileId, error: err.message });
            // Fall back to original file
          }
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
