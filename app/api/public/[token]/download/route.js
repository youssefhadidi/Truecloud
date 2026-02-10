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

// Increase timeout for large folder downloads
export const maxDuration = 300; // 5 minutes

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
    const downloadName = subPath ? basename(subPath) : share.fileName;
    const resolvedPath = resolve(filePath) + sep;

    // Security: prevent directory traversal
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
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
          'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}.zip"`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // If it's a file, return it directly
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = lookup(downloadName) || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileStats.size.toString(),
        'Content-Disposition': `attachment; filename="${basename(downloadName)}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('GET /api/public/[token]/download - Error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
