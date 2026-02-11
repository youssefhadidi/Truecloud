/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import fs from 'fs';
import { stat, mkdir } from 'fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { Semaphore } from '@/lib/semaphore';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// Semaphore to limit concurrent image optimizations to 3
const optimizationSemaphore = new Semaphore(3);

export const maxDuration = 30;

export async function GET(req, { params }) {
  // Acquire semaphore permit before processing
  await optimizationSemaphore.acquire();

  try {
    const { token } = await params;
    const url = new URL(req.url);
    // Accept password from header or query param (for img/video tags that can't send headers)
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;
    const quality = Math.min(Math.max(parseInt(url.searchParams.get('quality') || '80'), 30), 100);
    const maxWidth = parseInt(url.searchParams.get('w') || '1440');
    const maxHeight = parseInt(url.searchParams.get('h') || '1440');

    // Build the path
    let pathCheck;
    if (share.isDirectory && subPath) {
      pathCheck = validateSharePath(share, subPath);
    } else if (share.isDirectory && fileName !== share.fileName) {
      pathCheck = validateSharePath(share, fileName);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(filePath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileStats = await stat(filePath);

    // Only process image files
    const fileExt = extname(fileName).toLowerCase();
    const isImageExt = IMAGE_EXTENSIONS.includes(fileExt);
    const mimeType = lookup(fileName) || (isImageExt ? `image/${fileExt.slice(1)}` : 'application/octet-stream');
    if (!mimeType.startsWith('image/') && !isImageExt) {
      return NextResponse.json({ error: 'Only images can be optimized' }, { status: 400 });
    }

    // Skip optimization for very small files or SVG
    if (mimeType === 'image/svg+xml' || fileExt === '.svg' || fileStats.size < 100000) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    try {
      // Generate cache key based on file path, quality, and dimensions
      // Uses the same scheme as the authenticated route so both share the cache
      const cacheKey = createHash('md5').update(`${filePath}-${quality}-${maxWidth}-${maxHeight}`).digest('hex');

      // Build cache path: split fullPath into directory and filename
      const lastSlash = pathCheck.fullPath.lastIndexOf('/');
      const relativeCacheDir = lastSlash >= 0 ? pathCheck.fullPath.substring(0, lastSlash) : '';
      const cacheDir = join(OPTI_CACHE_DIR, relativeCacheDir);
      const cacheFileName = `${cacheKey}.webp`;
      const cachePath = join(cacheDir, cacheFileName);

      // Check if cached version exists and is newer than source file
      if (fs.existsSync(cachePath)) {
        const cacheStats = await stat(cachePath);
        if (cacheStats.mtimeMs >= fileStats.mtimeMs) {
          const cachedBuffer = fs.readFileSync(cachePath);
          return new NextResponse(cachedBuffer, {
            headers: {
              'Content-Type': 'image/webp',
              'Content-Length': cachedBuffer.length.toString(),
              'Cache-Control': 'public, max-age=31536000',
              'X-Cache': 'HIT',
            },
          });
        }
      }

      // Optimize image using sharp
      const optimizedBuffer = await sharp(filePath, {
        failOn: 'none',
        failOnError: false,
        limitInputPixels: false,
      })
        .rotate()
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer();

      // Cache the optimized image
      try {
        await mkdir(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, optimizedBuffer);
      } catch (cacheError) {
        console.error('Failed to cache optimized image:', cacheError);
      }

      return new NextResponse(optimizedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': optimizedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
          'X-Cache': 'MISS',
        },
      });
    } catch (sharpError) {
      // If sharp fails, return original image
      console.error('Image optimization failed:', sharpError);
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
  } catch (error) {
    console.error('GET /api/public/[token]/optimize-image - Error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  } finally {
    // Always release semaphore permit
    optimizationSemaphore.release();
  }
}
