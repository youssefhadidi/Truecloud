/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import {
  applyExifRotation,
  generateImageThumbnail,
  generateVideoThumbnail,
  generateHeicThumbnail,
  generatePdfThumbnail,
} from '@/lib/thumbnailUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = process.env.HEIC_DIR || './heic'; // Store original HEIC files
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';

// Increase timeout for thumbnail generation (HEIC and PDF processing can be slow)
export const maxDuration = 60;

// Semaphore to limit concurrent thumbnail generation
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++;
      logger.debug('Semaphore acquired', { active: this.count, max: this.max, queued: this.queue.length });
      return Promise.resolve();
    }

    logger.debug('Semaphore waiting', { active: this.count, max: this.max, queued: this.queue.length });
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.count--;
    logger.debug('Semaphore released', { active: this.count, max: this.max, queued: this.queue.length });
    if (this.queue.length > 0) {
      this.count++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

const thumbnailSemaphore = new Semaphore(15); // Limited parallelization to prevent resource exhaustion

export async function GET(req, { params }) {
  const startTime = Date.now();
  let fileId = 'unknown';

  try {
    logger.debug('GET /api/files/thumbnail - Request received');
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/thumbnail - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    fileId = safeDecodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/thumbnail - Processing', { fileId, path: relativePath });

    // Check permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/thumbnail - Access denied', { fileId, relativePath, userId: session.user.id });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/thumbnail - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const heicDir = resolve(process.cwd(), HEIC_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
    const streamCacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);

    // Try HEIC directory first, then uploads directory (matches convert-heic and optimize-image behavior)
    let filePath = join(heicDir, relativePath, fileId);
    try {
      await fsPromises.access(filePath);
      logger.debug('GET /api/files/thumbnail - Found in heic directory', { filePath });
    } catch {
      // Not in heic directory, try uploads
      filePath = join(uploadsDir, relativePath, fileId);
      logger.debug('GET /api/files/thumbnail - Trying uploads directory', { filePath });
    }

    // Check if file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      logger.warn('GET /api/files/thumbnail - File not found', { filePath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Get file extension for type detection
    const fileExt = extname(fileId).toLowerCase();

    // For MP4 videos, check if we have a stream-cache version (faster to process)
    if (fileExt === '.mp4') {
      const pathHash = createHash('md5').update(filePath).digest('hex');
      const cachedPath = join(streamCacheDir, `${pathHash}.mp4`);

      try {
        await fsPromises.access(cachedPath);
        logger.debug('GET /api/files/thumbnail - Using stream-cache version for thumbnail', { fileId, cachedPath });
        filePath = cachedPath;
      } catch {
        logger.debug('GET /api/files/thumbnail - No stream-cache version, using original', { fileId });
      }
    }

    // Supported file extensions
    const imageExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png', '.webp', '.svg', '.ico'];
    const heicExtensions = ['.heic', '.heif'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
    const pdfExtensions = ['.pdf'];

    const isImage = imageExtensions.includes(fileExt);
    const isHeic = heicExtensions.includes(fileExt);
    const isVideo = videoExtensions.includes(fileExt);
    const isPdf = pdfExtensions.includes(fileExt);

    if (!isImage && !isHeic && !isVideo && !isPdf) {
      logger.debug('GET /api/files/thumbnail - Unsupported file type', { fileId, fileExt });
      return NextResponse.json({ error: 'Thumbnail generation not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail filename - always use WebP format
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.webp`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    // Ensure thumbnails directory exists
    await fsPromises.mkdir(thumbnailsDir, { recursive: true });

    // Check if thumbnail already exists
    let thumbnailExists = false;
    let actualThumbnailPath = thumbnailPath;
    try {
      await fsPromises.stat(thumbnailPath);
      thumbnailExists = true;
    } catch {
      // If in trash, check if thumbnail exists for the original path (without trash/)
      const isTrashPath = relativePath === 'trash' || relativePath.startsWith('trash/') || relativePath.startsWith('trash\\');
      if (isTrashPath) {
        const originalPath = relativePath.replace(/^trash[/\\]?/, '');
        const originalThumbnailFileName = `${originalPath.replace(/[/\\]/g, '_')}_${fileId}.webp`;
        const originalThumbnailPath = join(thumbnailsDir, originalThumbnailFileName);
        try {
          await fsPromises.stat(originalThumbnailPath);
          thumbnailExists = true;
          actualThumbnailPath = originalThumbnailPath;
          logger.debug('GET /api/files/thumbnail - Found thumbnail from original path', { fileId, originalPath });
        } catch {
          // Doesn't exist yet
        }
      }
    }

    // If thumbnail doesn't exist, generate it now (synchronously)
    if (!thumbnailExists) {
      logger.info('GET /api/files/thumbnail - Generating thumbnail', { fileId, isPdf, isHeic, isVideo, isImage });

      await thumbnailSemaphore.acquire();
      try {
        if (isPdf) {
          await generatePdfThumbnail(filePath, thumbnailPath);
        } else if (isHeic) {
          await generateHeicThumbnail(filePath, thumbnailPath, fileId);
        } else if (isVideo) {
          await generateVideoThumbnail(filePath, thumbnailPath);
        } else {
          // Image: auto-rotate based on EXIF orientation
          const sharp = (await import('sharp')).default;

          try {
            let sharpInstance = sharp(filePath, {
              failOnError: false,
              limitInputPixels: false,
            });

            const metadata = await sharpInstance.metadata();
            sharpInstance = applyExifRotation(sharpInstance, metadata);

            const buffer = await sharpInstance.toBuffer();
            await generateImageThumbnail(buffer, thumbnailPath);
          } catch (error) {
            logger.warn('Orientation detection failed, processing without rotation', { fileId, error: error.message });
            await generateImageThumbnail(filePath, thumbnailPath);
          }
        }
        logger.info('GET /api/files/thumbnail - Generation complete', { fileId });
      } catch (error) {
        logger.error('GET /api/files/thumbnail - Generation failed', { fileId, error: error.message });

        // Return a more specific error message instead of crashing
        const errorMessage = error.message.includes('ImageMagick')
          ? 'PDF thumbnails require ImageMagick to be installed'
          : error.message.includes('FFmpeg')
            ? 'Video thumbnails require FFmpeg to be installed'
            : 'Thumbnail generation failed';

        return NextResponse.json(
          {
            error: errorMessage,
            details: error.message,
          },
          { status: 500 },
        );
      } finally {
        thumbnailSemaphore.release();
      }
    }

    // Read thumbnail and convert to base64
    const thumbnailBuffer = await fsPromises.readFile(actualThumbnailPath);
    const base64 = thumbnailBuffer.toString('base64');
    const dataUrl = `data:image/webp;base64,${base64}`;

    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/thumbnail - Returning base64', {
      fileId,
      duration: `${duration}ms`,
      generated: !thumbnailExists,
    });

    return NextResponse.json({
      data: dataUrl,
      generated: !thumbnailExists,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/thumbnail - Unexpected error', {
      fileId,
      error: error.message,
      duration: `${duration}ms`,
    });
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
