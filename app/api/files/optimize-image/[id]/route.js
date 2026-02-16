/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, mkdir } from 'fs/promises';
import { join } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { Semaphore } from '@/lib/semaphore';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';

// Semaphore to limit concurrent image optimizations to 10
const optimizationSemaphore = new Semaphore(20);

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

    const filePath = join(UPLOAD_DIR, relativePath, fileName);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const fileStats = await stat(filePath);

    // Only process image files
    const mimeType = lookup(fileName) || 'application/octet-stream';
    if (!mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Only images can be optimized' }, { status: 400 });
    }

    // Skip optimization for very small files or SVG
    if (mimeType === 'image/svg+xml' || fileStats.size < 100000) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Generate cache key based on file path, quality, dimensions, and format
    const cacheKey = createHash('md5').update(`${filePath}-${quality}-${maxWidth}-${maxHeight}-${format}`).digest('hex');

    // Create cache path preserving directory structure
    const relativeCacheDir = join(relativePath);
    const cacheDir = join(OPTI_CACHE_DIR, relativeCacheDir);
    const cacheFileName = `${cacheKey}.${format}`;
    const cachePath = join(cacheDir, cacheFileName);

    // Check if cached version exists and is newer than source file
    if (fs.existsSync(cachePath)) {
      const cacheStats = await stat(cachePath);
      if (cacheStats.mtimeMs >= fileStats.mtimeMs) {
        // Serve cached version without semaphore
        const cachedBuffer = fs.readFileSync(cachePath);
        const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        return new NextResponse(cachedBuffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': cachedBuffer.length.toString(),
            'Cache-Control': 'public, max-age=31536000',
            'X-Cache': 'HIT',
          },
        });
      }
    }

    // Acquire semaphore only for actual optimization
    await optimizationSemaphore.acquire();

    try {
      // Optimize image using sharp
      let sharpPipeline = sharp(filePath, {
        failOn: 'none',
        failOnError: false,
        limitInputPixels: false,
      })
        .rotate();

      // Only resize if dimensions are not 0x0 (0x0 means preserve original)
      if (maxWidth !== 0 || maxHeight !== 0) {
        sharpPipeline = sharpPipeline.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Apply format conversion
      if (format === 'jpeg') {
        sharpPipeline = sharpPipeline.jpeg({ quality: 100, mozjpeg: true });
      } else {
        sharpPipeline = sharpPipeline.webp({ quality });
      }

      const optimizedBuffer = await sharpPipeline.toBuffer();

      // Cache the optimized image
      try {
        await mkdir(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, optimizedBuffer);
      } catch (cacheError) {
        console.error('Failed to cache optimized image:', cacheError);
        // Continue even if caching fails
      }

      const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      return new NextResponse(optimizedBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': optimizedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
          'X-Cache': 'MISS',
        },
      });
    } catch (sharpError) {
      // If sharp fails, return original image
      console.error('Image optimization failed, serving original:', sharpError);
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    } finally {
      // Release semaphore after optimization completes
      optimizationSemaphore.release();
    }
  } catch (error) {
    console.error('Optimize image error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
