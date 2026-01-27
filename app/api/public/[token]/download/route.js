/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import fs from 'fs';
import { stat } from 'fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import { lookup } from 'mime-types';
import archiver from 'archiver';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    // Accept password from header or query param
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

    // Get optional subpath for directory shares
    const subPath = url.searchParams.get('path') || '';

    // Validate the path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);
    const resolvedPath = resolve(filePath) + sep;

    // Security: prevent directory traversal
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileStats = await stat(filePath);

    // If it's a directory, create a zip archive
    if (fileStats.isDirectory()) {
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      const chunks = [];

      const archivePromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve());
        archive.on('error', reject);
      });

      archive.on('data', (chunk) => chunks.push(chunk));

      archive.directory(filePath, false);
      archive.finalize();

      await archivePromise;

      const zipBuffer = Buffer.concat(chunks);

      return new NextResponse(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': zipBuffer.length.toString(),
          'Content-Disposition': `attachment; filename="${basename(share.fileName)}.zip"`,
        },
      });
    }

    // If it's a file, return it directly
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = lookup(share.fileName) || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileStats.size.toString(),
        'Content-Disposition': `attachment; filename="${basename(share.fileName)}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('GET /api/public/[token]/download - Error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
