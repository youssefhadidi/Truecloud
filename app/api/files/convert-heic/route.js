/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname } from 'node:path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const CACHE_DIR = './heic-cache';

// Convert HEIC to JPEG
async function convertHeicToJpeg(inputPath, outputPath) {
  const startTime = Date.now();
  logger.debug('Starting HEIC to JPEG conversion', { inputPath, outputPath });

  return new Promise((resolve, reject) => {
    const args = [
      inputPath,
      '-quality',
      '90',
      '-strip', // Remove EXIF data for privacy/smaller size
      outputPath,
    ];

    const magick = spawn('magick', args);
    let errorOutput = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      magick.kill();
      const duration = Date.now() - startTime;
      logger.error('HEIC conversion timeout', { inputPath, duration: `${duration}ms` });
      reject(new Error('Conversion timeout after 30 seconds'));
    }, 30000);

    magick.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    magick.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('HEIC to JPEG conversion completed', { inputPath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('HEIC conversion failed', { inputPath, code, duration: `${duration}ms`, errorOutput });
        if (errorOutput.includes('no decode delegate') || errorOutput.includes('libheif')) {
          reject(new Error('libheif is required for HEIC support. Install ImageMagick with libheif support.'));
        } else {
          reject(new Error(`Conversion failed with code ${code}: ${errorOutput}`));
        }
      }
    });

    magick.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      logger.error('HEIC conversion spawn error', { inputPath, error: err.message, duration: `${duration}ms` });
      reject(new Error(`Conversion spawn error: ${err.message}`));
    });
  });
}

export async function GET(req) {
  const startTime = Date.now();
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/convert-heic - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const fileId = url.searchParams.get('id');
    const relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/convert-heic - Processing', { fileId, path: relativePath });

    if (!fileId) {
      logger.error('GET /api/files/convert-heic - Missing file ID');
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
    }

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/convert-heic - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), CACHE_DIR);
    const filePath = join(uploadsDir, relativePath, fileId);

    // Verify file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      logger.warn('GET /api/files/convert-heic - File not found', { filePath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check file extension
    const fileExt = extname(fileId).toLowerCase();
    if (!['.heic', '.heif'].includes(fileExt)) {
      logger.debug('GET /api/files/convert-heic - Not a HEIC file', { fileId, fileExt });
      return NextResponse.json({ error: 'Only HEIC/HEIF files are supported' }, { status: 400 });
    }

    // Create cache directory if it doesn't exist
    await fsPromises.mkdir(cacheDir, { recursive: true });

    // Generate cache filename based on file path hash
    const pathHash = createHash('md5').update(filePath).digest('hex');
    const cachedFileName = `${pathHash}.jpg`;
    const cachedFilePath = join(cacheDir, cachedFileName);

    // Check if cached version exists and is newer than source
    try {
      const [sourceStats, cachedStats] = await Promise.all([fsPromises.stat(filePath), fsPromises.stat(cachedFilePath)]);

      if (cachedStats.mtime >= sourceStats.mtime) {
        const etag = `"${cachedStats.mtime.getTime()}-${cachedStats.size}"`;

        // Check if client has cached version
        const ifNoneMatch = req.headers.get('if-none-match');
        if (ifNoneMatch === etag) {
          const duration = Date.now() - startTime;
          logger.debug('GET /api/files/convert-heic - Cache hit (304)', { fileId, duration: `${duration}ms` });
          return new NextResponse(null, { status: 304 });
        }

        // Serve cached file
        const fileStream = fs.createReadStream(cachedFilePath);
        const duration = Date.now() - startTime;
        logger.debug('GET /api/files/convert-heic - Serving cached conversion', { fileId, duration: `${duration}ms` });
        return new NextResponse(fileStream, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: etag,
            'Content-Length': cachedStats.size.toString(),
          },
        });
      }
    } catch {
      // Cache doesn't exist, proceed to conversion
      logger.debug('GET /api/files/convert-heic - No cached conversion, converting', { fileId });
    }

    // Convert HEIC to JPEG
    logger.info('GET /api/files/convert-heic - Converting HEIC file', { fileId });
    await convertHeicToJpeg(filePath, cachedFilePath);

    // Serve the converted file
    const stats = await fsPromises.stat(cachedFilePath);
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;
    const fileStream = fs.createReadStream(cachedFilePath);
    const duration = Date.now() - startTime;
    logger.info('GET /api/files/convert-heic - Conversion complete and served', { fileId, duration: `${duration}ms` });

    return new NextResponse(fileStream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
        'Content-Length': stats.size.toString(),
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/convert-heic - Error', { error: error.message, duration: `${duration}ms` });
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
