/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import fs from 'fs';
import { stat } from 'fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import { lookup } from 'mime-types';
import archiver from 'archiver';
import { nodeToWebStream } from '@/lib/streamUtils';

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

      // Create a ReadableStream that pipes from the archive with proper error handling
      const stream = new ReadableStream({
        cancel() {
          // Client disconnected — abort the archive so all file descriptors are released
          archive.abort();
        },

        start(controller) {
          let isErrored = false;

          archive.on('data', (chunk) => {
            try {
              if (!isErrored) {
                controller.enqueue(chunk);
              }
            } catch (err) {
              console.error('Error enqueueing archive chunk:', err);
              isErrored = true;
              controller.error(err);
              archive.abort();
            }
          });

          archive.on('end', () => {
            if (!isErrored) {
              controller.close();
            }
          });

          archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!isErrored) {
              isErrored = true;
              controller.error(err);
            }
          });

          archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
              // File not found warning, continue
              console.warn('Archive warning:', err.message);
            } else {
              console.error('Archive warning:', err);
              isErrored = true;
              controller.error(err);
              archive.abort();
            }
          });

          try {
            // Add directory contents to archive
            archive.directory(filePath, false);
            archive.finalize();
          } catch (err) {
            console.error('Error finalizing archive:', err);
            isErrored = true;
            controller.error(err);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}.zip"; filename*=UTF-8''${encodeURIComponent(downloadName)}.zip`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // If it's a file, stream it directly.
    // nodeToWebStream ensures the underlying fs.ReadStream is destroyed
    // when the client disconnects, preventing file descriptor leaks.
    const mimeType = lookup(downloadName) || 'application/octet-stream';

    return new NextResponse(
      nodeToWebStream(fs.createReadStream(filePath)),
      {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(basename(downloadName))}"; filename*=UTF-8''${encodeURIComponent(basename(downloadName))}`,
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (error) {
    console.error('GET /api/public/[token]/download - Error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
