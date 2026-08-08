/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { requireFolderUnlock } from '@/lib/folderLocks';
import { generateImageThumbnail, generateVideoThumbnail, generatePdfThumbnail } from '@/lib/thumbnailUtils';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS } from '@/lib/extensions';
import { Semaphore } from '@/lib/semaphore';
import { thumbnailCache } from '@/lib/thumbnailCache';
import { isUploadTempName } from '@/lib/uploadTemp';
import { thumbnailKey } from '@/lib/thumbnailKey.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Increase timeout for thumbnail generation (HEIC and PDF processing can be slow)
export const maxDuration = 60;

// Semaphore to limit concurrent thumbnail generation
const thumbnailSemaphore = new Semaphore(20); // Limited parallelization to prevent resource exhaustion

export async function GET(req, { params }) {
  const startTime = Date.now();
  let fileId = 'unknown';

  try {
    logger.debug('GET /api/files/thumbnail - Request received');
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    fileId = safeDecodeURIComponent(resolvedParams.id);

    // Refuse in-flight upload temp files — a list refresh fired by an early
    // upload event can request a thumbnail before the rename has happened,
    // which would otherwise cache a broken thumbnail from a partial file.
    if (isUploadTempName(fileId)) {
      return NextResponse.json({ error: 'Upload in progress' }, { status: 404 });
    }

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

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/thumbnail - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
    const streamCacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);

    let filePath = join(uploadsDir, relativePath, fileId);

    // Check if file exists and capture its size for the (path-independent)
    // thumbnail key. Done before any .mp4 stream-cache reassignment below so the
    // key reflects the original file, not the cache copy.
    let fileStats;
    try {
      fileStats = await fsPromises.stat(filePath);
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

    // Classify file type
    const isImage = IMAGE_EXTENSIONS.includes(fileExt);
    const isVideo = VIDEO_EXTENSIONS.includes(fileExt);
    const isPdf = PDF_EXTENSIONS.includes(fileExt);

    if (!isImage && !isVideo && !isPdf) {
      logger.debug('GET /api/files/thumbnail - Unsupported file type', { fileId, fileExt });
      return NextResponse.json({ error: 'Thumbnail generation not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail filename - always use WebP format. Keyed on name+size
    // (not path) so it survives folder rename/move.
    const thumbnailFileName = `${thumbnailKey(fileId, fileStats.size)}.webp`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    // Fast path: check memory cache first
    let cachedBuffer = thumbnailCache.get(thumbnailPath);
    if (cachedBuffer) {
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/thumbnail - Serving from memory cache', {
        fileId,
        duration: `${duration}ms`,
        size: cachedBuffer.length,
      });
      return new NextResponse(cachedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': cachedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Cache': 'MEMORY',
        },
      });
    }

    // Check if thumbnail already exists. The name+size key is identical whether
    // the file sits in trash/ or its original folder, so no trash fallback is
    // needed — the same thumbnail is found automatically.
    let thumbnailExists = false;
    const actualThumbnailPath = thumbnailPath;
    try {
      await fsPromises.stat(thumbnailPath);
      thumbnailExists = true;
    } catch {
      // Doesn't exist yet — generate below.
    }

    // If thumbnail doesn't exist, generate it now (synchronously)
    if (!thumbnailExists) {
      logger.info('GET /api/files/thumbnail - Generating thumbnail', { fileId, isPdf, isVideo, isImage });

      // Ensure thumbnails directory exists (only when needed)
      await fsPromises.mkdir(thumbnailsDir, { recursive: true });

      await thumbnailSemaphore.acquire();
      try {
        if (isPdf) {
          await generatePdfThumbnail(filePath, thumbnailPath);
        } else if (isVideo) {
          await generateVideoThumbnail(filePath, thumbnailPath);
        } else {
          // Image — sharp handles all formats + auto-rotation
          await generateImageThumbnail(filePath, thumbnailPath);
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

    // Read thumbnail and serve as binary
    let thumbnailBuffer = thumbnailCache.get(actualThumbnailPath);
    if (!thumbnailBuffer) {
      thumbnailBuffer = await fsPromises.readFile(actualThumbnailPath);
      thumbnailCache.set(actualThumbnailPath, thumbnailBuffer);
    }

    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/thumbnail - Returning WebP', {
      fileId,
      duration: `${duration}ms`,
      cacheHit: thumbnailExists,
      size: thumbnailBuffer.length,
    });

    return new NextResponse(thumbnailBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnailBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Cache': thumbnailExists ? 'HIT' : 'MISS',
      },
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
