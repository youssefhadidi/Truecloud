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
import { requireFolderUnlock } from '@/lib/folderLocks';
import { logger } from '@/lib/logger';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

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

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const filePath = join(UPLOAD_DIR, relativePath, fileName);

    // A cache dir configured under UPLOAD_DIR is hidden from listings, so it
    // must not be reachable by crafting a path either — this route zips whole
    // directories, which would otherwise hand back the entire cache.
    if (isCachePath(filePath)) {
      logger.warn('Download: blocked reserved cache path', {
        path: relativePath,
        fileName,
        user: session.user.email,
      });
      return NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const fileStats = await stat(filePath);

    // If it's a directory, create a streaming zip archive.
    // We use Readable.toWeb (pull-based) so client disconnect backpressures
    // the archiver and triggers cancel() / destroy() — see lib/streamUtils.js.
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
        try { archive.destroy(); } catch {}
      };

      archive.on('error', (err) => logger.error('Download: archive error', { error: err.message }));
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          logger.warn('Download: archive warning (missing file)', { message: err.message });
        } else {
          logger.error('Download: archive warning', { error: err.message });
          abortArchive('archive-warning');
        }
      });
      archive.on('close', () => logger.debug?.('Download: archive closed', { path: filePath }));

      // Belt-and-suspenders: also listen to req.signal in case Readable.toWeb's
      // cancel propagation lags behind the actual disconnect.
      if (req.signal) {
        if (req.signal.aborted) abortArchive('signal-already-aborted');
        else req.signal.addEventListener('abort', () => abortArchive('req.signal abort'), { once: true });
      }

      try {
        archive.directory(filePath, false);
        archive.finalize();
      } catch (err) {
        logger.error('Download: error finalizing archive', { error: err.message });
        abortArchive('finalize-throw');
      }

      const stream = nodeToWebStream(archive);

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
