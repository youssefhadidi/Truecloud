/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath, isWithinShare,
} from '@/lib/shareAuth';
import fs from 'fs';
import { stat, mkdir } from 'fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { optiCachePath } from '@/lib/optiCache.mjs';
import { OPTIMIZE_MIN_BYTES } from '@/lib/imageVariants.mjs';
import { Semaphore } from '@/lib/semaphore';
import { buildValidators, evaluateConditional, mediaCacheControl } from '@/lib/httpRange';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';

// Semaphore to limit concurrent image optimizations to 20
const optimizationSemaphore = new Semaphore(20);

export const maxDuration = 30;

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    // Accept password from header or query param (for img/video tags that can't send headers)
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
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

    // Build the path. For directory shares, combine the in-share subPath with
    // the target fileName so we resolve to the actual file rather than its
    // parent directory.
    let pathCheck;
    if (share.isDirectory) {
      const innerPath = subPath
        ? (fileName && fileName !== share.fileName ? `${subPath}/${fileName}` : subPath)
        : (fileName && fileName !== share.fileName ? fileName : '');
      pathCheck = validateSharePath(share, innerPath);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Private-uploads shares: visitors can only read their own entries
    // (never the share root itself, e.g. a whole-folder zip)
    const privateCheck = await authorizePrivatePath(share, readShareEmail(req, token), shareInnerPath(share, pathCheck.fullPath));
    if (!privateCheck.allowed) {
      return NextResponse.json(privateAccessErrorBody(privateCheck), { status: privateCheck.status });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal (including via symlinks)
    if (!(await isWithinShare(share, pathCheck.fullPath))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Cache dirs under UPLOAD_DIR are hidden from share listings; don't serve them either
    if (isCachePath(filePath)) {
      return NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 });
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

    const validators = buildValidators(fileStats);
    const cacheHeaders = share.privateUploads
      ? { 'Cache-Control': 'private, no-store' }
      : { ETag: validators.etag, 'Last-Modified': validators.lastModified, 'Cache-Control': mediaCacheControl(url) };
    if (!share.privateUploads && evaluateConditional(req, validators, false).notModified) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    // Skip optimization for very small files or SVG
    if (mimeType === 'image/svg+xml' || fileExt === '.svg' || fileStats.size < OPTIMIZE_MIN_BYTES) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          ...cacheHeaders,
        },
      });
    }

    // Same key the signed-in route and the cache worker use (lib/optiCache.mjs),
    // so a share visitor gets the variant a signed-in viewer already made.
    const lastSlash = pathCheck.fullPath.lastIndexOf('/');
    const relativeCacheDir = lastSlash >= 0 ? pathCheck.fullPath.substring(0, lastSlash) : '';
    const cachePath = optiCachePath(resolve(process.cwd(), OPTI_CACHE_DIR), relativeCacheDir, resolve(filePath), fileStats, {
      quality,
      width: maxWidth,
      height: maxHeight,
      format: 'webp',
    });
    const cacheDir = dirname(cachePath);

    // The key covers the source's size and mtime, so any file found here was
    // made from the current version.
    if (fs.existsSync(cachePath)) {
      // Serve cached version without semaphore
      const cachedBuffer = fs.readFileSync(cachePath);
      return new NextResponse(cachedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': cachedBuffer.length.toString(),
          ...cacheHeaders,
          'X-Cache': 'HIT',
        },
      });
    }

    // Acquire semaphore only for actual optimization
    await optimizationSemaphore.acquire();

    try {
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
          ...cacheHeaders,
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
          // Fallback bytes, not the variant this URL names — don't pin them.
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      // Release semaphore after optimization completes
      optimizationSemaphore.release();
    }
  } catch (error) {
    console.error('GET /api/public/[token]/optimize-image - Error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
