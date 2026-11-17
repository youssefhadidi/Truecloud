/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath, isWithinShare,
} from '@/lib/shareAuth';
import { stat, readFile } from 'fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { getOptimizedImage } from '@/lib/optimizeImage';
import { OPTIMIZE_MIN_BYTES } from '@/lib/imageVariants.mjs';
import { buildValidators, evaluateConditional, mediaCacheControl } from '@/lib/httpRange';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

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

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

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
      const fileBuffer = await readFile(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileBuffer.length.toString(),
          ...cacheHeaders,
        },
      });
    }

    // Memory, disk, a shared in-flight job, or a new one (lib/optimizeImage.js).
    // Same cache key as the signed-in route, so a share visitor gets the
    // variant a signed-in viewer already made.
    const { buffer, cache } = await getOptimizedImage({
      filePath,
      stat: fileStats,
      variant: { quality, width: maxWidth, height: maxHeight, format: 'webp' },
      signal: req.signal,
    });

    const failed = cache === 'ORIGINAL';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': failed ? mimeType : 'image/webp',
        'Content-Length': buffer.length.toString(),
        // Fallback bytes, not the variant this URL names — don't pin them.
        ...(failed ? { 'Cache-Control': 'no-store' } : cacheHeaders),
        'X-Cache': cache,
      },
    });
  } catch (error) {
    // The client went away while its job was still queued
    if (error?.name === 'AbortError') return new NextResponse(null, { status: 499 });
    console.error('GET /api/public/[token]/optimize-image - Error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
