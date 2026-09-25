/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { stat, mkdir, readFile, writeFile, rename, unlink } from 'fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { randomBytes } from 'crypto';
import { optiCachePath } from '@/lib/optiCache.mjs';
import { OPTIMIZE_MIN_BYTES } from '@/lib/imageVariants.mjs';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { requireFolderUnlock } from '@/lib/folderLocks';
import { Semaphore } from '@/lib/semaphore';
import { thumbnailCache } from '@/lib/thumbnailCache';
import { buildValidators, evaluateConditional, mediaCacheControl } from '@/lib/httpRange';

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

    // Validators describe the source file: every variant of it changes exactly
    // when it does, and each variant has its own URL.
    const validators = buildValidators(fileStats);
    const cacheHeaders = {
      ETag: validators.etag,
      'Last-Modified': validators.lastModified,
      'Cache-Control': mediaCacheControl(url),
    };
    if (evaluateConditional(req, validators, false).notModified) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    // Skip optimization for SVG or very small files — serve as-is
    if (fileExt === '.svg' || fileStats.size < OPTIMIZE_MIN_BYTES) {
      const fileBuffer = await readFile(filePath);
      const mimeType = lookup(fileName) || 'application/octet-stream';
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          ...cacheHeaders,
        },
      });
    }

    // Same key the share route and the cache worker use (lib/optiCache.mjs)
    const cachePath = optiCachePath(resolve(process.cwd(), OPTI_CACHE_DIR), relativePath, resolve(filePath), fileStats, {
      quality,
      width: maxWidth,
      height: maxHeight,
      format,
    });
    const cacheDir = dirname(cachePath);

    // Fast path: check memory cache first
    const memoryCached = thumbnailCache.get(cachePath);
    if (memoryCached) {
      const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      return new NextResponse(memoryCached, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': memoryCached.length.toString(),
          ...cacheHeaders,
          'X-Cache': 'MEMORY',
        },
      });
    }

    // Disk cache. The key covers the source's size and mtime, so any file
    // found here was made from the current version.
    try {
      const cachedBuffer = await readFile(cachePath);
      thumbnailCache.set(cachePath, cachedBuffer);
      const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      return new NextResponse(cachedBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': cachedBuffer.length.toString(),
          ...cacheHeaders,
          'X-Cache': 'HIT',
        },
      });
    } catch {
      // Not cached yet, will optimize
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

    // Store in memory cache + fire-and-forget disk cache write. Written to a
    // temp name and renamed, so a concurrent request that finds the file never
    // reads (and memory-caches) a half-written one.
    if (!optimizationFailed) {
      thumbnailCache.set(cachePath, optimizedBuffer);
      const tmpPath = `${cachePath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
      mkdir(cacheDir, { recursive: true })
        .then(() => writeFile(tmpPath, optimizedBuffer))
        .then(() => rename(tmpPath, cachePath))
        .catch(async (cacheError) => {
          await unlink(tmpPath).catch(() => {});
          console.error('Failed to cache optimized image:', cacheError);
        });
    }

    const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return new NextResponse(optimizedBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': optimizedBuffer.length.toString(),
        // A failed optimization serves the original instead; don't let the
        // browser pin that in place of the real variant.
        ...(optimizationFailed ? { 'Cache-Control': 'no-store' } : cacheHeaders),
        'X-Cache': optimizationFailed ? 'ORIGINAL' : 'MISS',
      },
    });
  } catch (error) {
    console.error('Optimize image error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
