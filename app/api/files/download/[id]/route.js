/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import fs from 'fs';
import { stat } from 'fs/promises';
import { join, basename } from 'node:path';
import { lookup } from 'mime-types';
import archiver from 'archiver';
import { Readable } from 'stream';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // If it's a directory, create a zip archive
    if (fileStats.isDirectory()) {
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      // Collect the archive data
      const chunks = [];

      // Set up promise before starting archive
      const archivePromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve());
        archive.on('error', reject);
      });

      archive.on('data', (chunk) => chunks.push(chunk));

      // Add directory contents to archive
      archive.directory(filePath, false);
      archive.finalize();

      // Wait for archive to complete
      await archivePromise;

      const zipBuffer = Buffer.concat(chunks);

      return new NextResponse(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': zipBuffer.length.toString(),
          'Content-Disposition': `attachment; filename="${basename(fileName)}.zip"`,
        },
      });
    }

    // If it's a file, return it directly
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = lookup(fileName) || 'application/octet-stream';

    // Determine cache duration based on file type
    let cacheControl = 'no-store'; // Default: don't cache
    if (mimeType.startsWith('image/')) {
      cacheControl = 'public, max-age=31536000'; // 1 year for images
    } else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
      cacheControl = 'public, max-age=604800'; // 1 week for media
    }

    return new NextResponse(fileBuffer, {
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
