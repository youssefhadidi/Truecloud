/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname, sep } from 'node:path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = process.env.HEIC_DIR || './.heic'; // Store original HEIC files
const HEIC_CACHE_DIR = process.env.HEIC_CACHE_DIR || './.heic-cache';

// Convert HEIC to WebP
async function convertHeicToWebp(inputPath, outputPath) {
  const startTime = Date.now();
  logger.debug('Starting HEIC to WebP conversion', { inputPath, outputPath });

  try {
    // Use heic-convert to convert HEIC to JPEG buffer, then use Sharp to convert to WebP
    const heicConvert = (await import('heic-convert')).default;
    const sharp = (await import('sharp')).default;

    const inputBuffer = await fsPromises.readFile(inputPath);
    const jpegBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.95,
    });

    // Convert JPEG to WebP
    const webpBuffer = await sharp(jpegBuffer)
      .webp({ quality: 85 })
      .toBuffer();

    await fsPromises.writeFile(outputPath, webpBuffer);

    const duration = Date.now() - startTime;
    logger.info('HEIC to WebP conversion completed', { inputPath, duration: `${duration}ms` });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('HEIC conversion failed', { inputPath, error: error.message, duration: `${duration}ms` });
    throw new Error(`HEIC conversion failed: ${error.message}`);
  }
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
    let relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/convert-heic - Processing', { fileId, path: relativePath });

    if (!fileId) {
      logger.error('GET /api/files/convert-heic - Missing file ID');
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
    }

    // Check user permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/convert-heic - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/convert-heic - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const heicDir = resolve(process.cwd(), HEIC_DIR);
    const cacheDir = resolve(process.cwd(), HEIC_CACHE_DIR);

    // Try HEIC directory first, then uploads directory
    let filePath = join(heicDir, relativePath, fileId);
    try {
      await fsPromises.access(filePath);
      logger.debug('GET /api/files/convert-heic - Found in heic directory', { filePath });
    } catch {
      // Not in heic directory, try uploads
      filePath = join(uploadsDir, relativePath, fileId);
      logger.debug('GET /api/files/convert-heic - Trying uploads directory', { filePath });
    }

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
    const cachedFileName = `${pathHash}.webp`;
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
            'Content-Type': 'image/webp',
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

    // Convert HEIC to WebP
    logger.info('GET /api/files/convert-heic - Converting HEIC file', { fileId });
    await convertHeicToWebp(filePath, cachedFilePath);

    // Serve the converted file
    const stats = await fsPromises.stat(cachedFilePath);
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;
    const fileStream = fs.createReadStream(cachedFilePath);
    const duration = Date.now() - startTime;
    logger.info('GET /api/files/convert-heic - Conversion complete and served', { fileId, duration: `${duration}ms` });

    return new NextResponse(fileStream, {
      headers: {
        'Content-Type': 'image/webp',
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
