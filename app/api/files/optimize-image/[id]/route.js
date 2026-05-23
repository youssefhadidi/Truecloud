/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { stat, mkdir, readFile, writeFile } from 'fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { createHash } from 'crypto';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { requireFolderUnlock } from '@/lib/folderLocks';
import { Semaphore } from '@/lib/semaphore';
import { thumbnailCache } from '@/lib/thumbnailCache';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';

// Semaphore to limit concurrent image optimizations to 10
const optimizationSemaphore = new Semaphore(10);

// Image optimization may take time, set appropriate timeout
export const maxDuration = 30;

export async function GET(req, { params }) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const { id } = await params;
    const fileName = safeDecodeURIComponent(id);

    // Get path and quality from query params
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';
    const quality = Math.min(Math.max(parseInt(url.searchParams.get('quality') || '80'), 30), 100);
    const maxWidth = parseInt(url.searchParams.get('w') || '1440');
    const maxHeight = parseInt(url.searchParams.get('h') || '1440');
    const format = url.searchParams.get('format') || 'webp';

    // Validate format
    if (!['webp', 'jpeg'].includes(format)) {
      return NextResponse.json({ error: 'Invalid format. Use webp or jpeg' }, { status: 400 });
    }

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileName.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
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
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    // Use normalized path
    relativePath = accessCheck.normalizedPath;

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const filePath = join(UPLOAD_DIR, relativePath, fileName);

    // Check if file exists and get stats in one operation
    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    // Only process image files — match on extension only
    const fileExt = extname(fileName).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(fileExt)) {
      return NextResponse.json({ error: 'Only images can be optimized' }, { status: 400 });
    }

    // Skip optimization for SVG or very small files — serve as-is
    if (fileExt === '.svg' || fileStats.size < 100000) {
      const fileBuffer = await readFile(filePath);
      const mimeType = lookup(fileName) || 'application/octet-stream';
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Generate cache key based on file path, quality, dimensions, format, and file mtime
    const cacheKey = createHash('md5').update(`${filePath}-${quality}-${maxWidth}-${maxHeight}-${format}-${fileStats.mtimeMs}`).digest('hex');
    const etag = `"${cacheKey}"`;

    // Check If-None-Match header for conditional requests
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'public, max-age=31536000' } });
    }

    // Create cache path preserving directory structure
    const relativeCacheDir = join(relativePath);
    const cacheDir = join(OPTI_CACHE_DIR, relativeCacheDir);
    const cacheFileName = `${cacheKey}.${format}`;
    const cachePath = join(cacheDir, cacheFileName);

    // Fast path: check memory cache first
    const memoryCached = thumbnailCache.get(cachePath);
    if (memoryCached) {
      const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      return new NextResponse(memoryCached, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': memoryCached.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
          ETag: etag,
          'X-Cache': 'MEMORY',
        },
      });
    }

    // Check if disk cached version exists and is newer than source file
    try {
      const cacheStats = await stat(cachePath);
      if (cacheStats.mtimeMs >= fileStats.mtimeMs) {
        const cachedBuffer = await readFile(cachePath);
        thumbnailCache.set(cachePath, cachedBuffer);
        const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        return new NextResponse(cachedBuffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': cachedBuffer.length.toString(),
            'Cache-Control': 'public, max-age=31536000',
            ETag: etag,
            'X-Cache': 'HIT',
          },
        });
      }
    } catch {
      // Cache doesn't exist or is invalid, will optimize
    }

    // Acquire semaphore only for actual optimization
    await optimizationSemaphore.acquire();

    let optimizedBuffer;
    let optimizationFailed = false;

    try {
      // Optimize image using sharp
      let sharpPipeline = sharp(filePath, {
        failOn: 'none',
        failOnError: false,
        limitInputPixels: false,
      }).rotate();

      // Only resize if dimensions are not 0x0 (0x0 means preserve original)
      if (maxWidth !== 0 || maxHeight !== 0) {
        sharpPipeline = sharpPipeline.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Apply format conversion
      if (format === 'jpeg') {
        sharpPipeline = sharpPipeline.jpeg({ quality: 100 });
      } else {
        sharpPipeline = sharpPipeline.webp({ quality });
      }

      optimizedBuffer = await sharpPipeline.toBuffer();
    } catch (sharpError) {
      // If sharp fails, flag it and use original image
      console.error('Image optimization failed, serving original:', sharpError);
      optimizationFailed = true;
      optimizedBuffer = await readFile(filePath);
    } finally {
      // Release semaphore immediately after optimization (don't wait for cache write)
      optimizationSemaphore.release();
    }

    // Store in memory cache + fire-and-forget disk cache write
    if (!optimizationFailed) {
      thumbnailCache.set(cachePath, optimizedBuffer);
      writeFile(cachePath, optimizedBuffer)
        .catch(async (cacheError) => {
          // Ensure cache directory exists on first error
          try {
            await mkdir(cacheDir, { recursive: true });
            await writeFile(cachePath, optimizedBuffer);
          } catch (retryError) {
            console.error('Failed to cache optimized image:', retryError);
          }
        });
    }

    const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return new NextResponse(optimizedBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': optimizedBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000',
        ETag: etag,
        'X-Cache': optimizationFailed ? 'ORIGINAL' : 'MISS',
      },
    });
  } catch (error) {
    console.error('Optimize image error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
