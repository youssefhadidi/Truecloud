/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { stat, readFile } from 'fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';
import { IMAGE_EXTENSIONS } from '@/lib/extensions';
import { getOptimizedImage } from '@/lib/optimizeImage';
import { OPTIMIZE_MIN_BYTES } from '@/lib/imageVariants.mjs';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { requireFolderUnlock } from '@/lib/folderLocks';
import { buildValidators, evaluateConditional, mediaCacheControl } from '@/lib/httpRange';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

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

    // Memory, disk, a shared in-flight job, or a new one (lib/optimizeImage.js)
    const { buffer, cache } = await getOptimizedImage({
      filePath,
      stat: fileStats,
      variant: { quality, width: maxWidth, height: maxHeight, format },
      signal: req.signal,
    });

    const failed = cache === 'ORIGINAL';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': failed ? lookup(fileName) || 'application/octet-stream' : format === 'jpeg' ? 'image/jpeg' : 'image/webp',
        'Content-Length': buffer.length.toString(),
        // A failed optimization serves the original instead; don't let the
        // browser pin that in place of the real variant.
        ...(failed ? { 'Cache-Control': 'no-store' } : cacheHeaders),
        'X-Cache': cache,
      },
    });
  } catch (error) {
    // The client went away while its job was still queued
    if (error?.name === 'AbortError') return new NextResponse(null, { status: 499 });
    console.error('Optimize image error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
