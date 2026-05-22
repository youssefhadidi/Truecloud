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
import { nodeToWebStream } from '@/lib/streamUtils';
import { logger } from '@/lib/logger';

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

      let aborted = false;
      const abortArchive = (reason) => {
        if (aborted) return;
        aborted = true;
        logger.info('Download: aborting zip archive', { reason, path: filePath });
        try { archive.abort(); } catch {}
      };

      // Next.js with a custom server doesn't always fire ReadableStream.cancel()
      // on client disconnect, so listen to req.signal directly.
      if (req.signal) {
        if (req.signal.aborted) abortArchive('signal-already-aborted');
        else req.signal.addEventListener('abort', () => abortArchive('req.signal abort'), { once: true });
      }

      // Create a ReadableStream that pipes from the archive with proper error handling
      const stream = new ReadableStream({
        cancel() {
          abortArchive('stream.cancel');
        },

        start(controller) {
          let isErrored = false;

          archive.on('data', (chunk) => {
            try {
              if (!isErrored) {
                controller.enqueue(chunk);
              }
            } catch (err) {
              logger.error('Download: error enqueueing archive chunk', { error: err.message });
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
            logger.error('Download: archive error', { error: err.message });
            if (!isErrored) {
              isErrored = true;
              controller.error(err);
            }
          });

          archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
              logger.warn('Download: archive warning (missing file)', { message: err.message });
            } else {
              logger.error('Download: archive warning', { error: err.message });
              isErrored = true;
              controller.error(err);
              archive.abort();
            }
          });

          try {
            archive.directory(filePath, false);
            archive.finalize();
          } catch (err) {
            logger.error('Download: error finalizing archive', { error: err.message });
            isErrored = true;
            controller.error(err);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(basename(fileName))}.zip"; filename*=UTF-8''${encodeURIComponent(basename(fileName))}.zip`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // If it's a file, stream it directly (don't load entire file into memory).
    // nodeToWebStream wraps the Node.js Readable in a Web ReadableStream with a
    // cancel() hook that calls nodeStream.destroy() when the client disconnects.
    // Without this, disconnected clients leave file descriptors open indefinitely
    // until the OS FD limit is hit, crashing the entire app.
    const mimeType = lookup(fileName) || 'application/octet-stream';

    // Determine cache duration based on file type
    let cacheControl = 'no-store'; // Default: don't cache
    if (mimeType.startsWith('image/')) {
      cacheControl = 'public, max-age=31536000'; // 1 year for images
    } else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
      cacheControl = 'public, max-age=604800'; // 1 week for media
    }

    return new NextResponse(
      nodeToWebStream(fs.createReadStream(filePath)),
      {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Content-Disposition': `inline; filename="${encodeURIComponent(basename(fileName))}"; filename*=UTF-8''${encodeURIComponent(basename(fileName))}`,
          'Cache-Control': cacheControl,
        },
      }
    );
  } catch (error) {
    logger.error('Download: handler error', { error: error.message });
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
