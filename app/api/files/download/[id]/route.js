/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat } from 'fs/promises';
import { join, basename } from 'node:path';
import { lookup } from 'mime-types';
import archiver from 'archiver';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Increase timeout for large folder downloads
export const maxDuration = 300; // 5 minutes

export async function GET(req, { params }) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const { id } = await params;
    const fileName = safeDecodeURIComponent(id);

    // Get path from query params
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

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

    // If it's a directory, create a streaming zip archive
    if (fileStats.isDirectory()) {
      const archive = archiver('zip', {
        zlib: { level: 1 }, // Fast compression (level 0-9, lower = faster)
      });

      // Create a ReadableStream that pipes from the archive
      const stream = new ReadableStream({
        start(controller) {
          archive.on('data', (chunk) => {
            controller.enqueue(chunk);
          });

          archive.on('end', () => {
            controller.close();
          });

          archive.on('error', (err) => {
            console.error('Archive error:', err);
            controller.error(err);
          });

          // Add directory contents to archive
          archive.directory(filePath, false);
          archive.finalize();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(basename(fileName))}.zip"`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // If it's a file, stream it directly (don't load entire file into memory)
    const fileStream = fs.createReadStream(filePath);
    const mimeType = lookup(fileName) || 'application/octet-stream';

    // Determine cache duration based on file type
    let cacheControl = 'no-store'; // Default: don't cache
    if (mimeType.startsWith('image/')) {
      cacheControl = 'public, max-age=31536000'; // 1 year for images
    } else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
      cacheControl = 'public, max-age=604800'; // 1 week for media
    }

    return new NextResponse(fileStream, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileStats.size.toString(),
        'Content-Disposition': `inline; filename="${basename(fileName)}"`,
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
