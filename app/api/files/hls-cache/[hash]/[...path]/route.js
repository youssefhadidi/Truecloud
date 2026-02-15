/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'node:path';
import mime from 'mime-types';
import { logger } from '@/lib/logger';

const HLS_CACHE_DIR = process.env.HLS_CACHE_DIR || './hls-cache';

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const hash = resolvedParams.hash;
    const pathArray = resolvedParams.path || [];

    // Security: validate hash is hex
    if (!/^[a-f0-9]{32}$/.test(hash)) {
      logger.error('Invalid hash format', { hash });
      return NextResponse.json({ error: 'Invalid hash' }, { status: 400 });
    }

    // Security: prevent directory traversal
    const relativePath = pathArray.join('/');
    if (relativePath.includes('..') || relativePath.includes('\\')) {
      logger.error('Directory traversal attempt', { hash, path: relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const cacheBaseDir = resolve(process.cwd(), HLS_CACHE_DIR);
    const filePath = join(cacheBaseDir, hash, relativePath);

    // Verify it's still within cache directory
    if (!filePath.startsWith(cacheBaseDir)) {
      logger.error('Path outside cache directory', { filePath, cacheBaseDir });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Read file
    const data = await readFile(filePath);
    const fileStats = await stat(filePath);

    // Determine MIME type
    let mimeType = 'application/octet-stream';
    if (filePath.endsWith('.m3u8')) {
      mimeType = 'application/vnd.apple.mpegurl';
    } else if (filePath.endsWith('.ts')) {
      mimeType = 'video/mp2t';
    } else {
      mimeType = mime.lookup(filePath) || 'application/octet-stream';
    }

    logger.debug('Serving cache file', { hash, path: relativePath, size: fileStats.size });

    // Determine cache headers based on file type
    let cacheControl = 'no-cache';
    if (filePath.endsWith('.ts')) {
      // Segments are immutable, cache forever
      cacheControl = 'public, max-age=31536000, immutable';
    }

    return new NextResponse(data, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileStats.size.toString(),
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    logger.error('HLS cache file error', { error: error.message });

    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
