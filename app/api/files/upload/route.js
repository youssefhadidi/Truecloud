/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink, open } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

// Allow large file uploads (set timeout to 30 minutes)
export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req) {
  const startTime = Date.now();
  let fileName = 'unknown';
  let writtenFilePath = null; // Track for cleanup on error
  let fileHandle = null;
  try {
    logger.info('POST /api/files/upload - Upload request received', {
      contentType: req.headers.get('content-type'),
      contentLength: req.headers.get('content-length'),
    });
    const session = await auth();
    if (!session) {
      logger.warn('POST /api/files/upload - Unauthorized upload attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read upload target path from query string (available before body is parsed)
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

    // Check user permissions before accepting any file data
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'write',
      isRootUser: isRoot,
    });

    logger.debug('POST /api/files/upload - Access check result', {
      userId: session.user.id,
      requestedPath: relativePath,
      isRoot,
      accessCheck,
    });

    if (!accessCheck.allowed) {
      logger.warn('POST /api/files/upload - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;
    if (accessCheck.redirected) {
      logger.info('POST /api/files/upload - Redirected to personal folder', {
        userId: session.user.id,
        newPath: relativePath,
      });
    }

    const targetDir = join(UPLOAD_DIR, relativePath);

    // Security: prevent directory traversal
    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/files/upload - Directory traversal attempt', {
        targetDir,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Ensure the target directory exists
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    if (!req.body) {
      logger.warn('POST /api/files/upload - No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Parse multipart FormData via busboy — streams file directly to disk
    const nodeStream = Readable.fromWeb(req.body);
    const { size, mimeType } = await new Promise((resolve, reject) => {
      let resolved = false;
      const busboy = Busboy({
        headers: { 'content-type': req.headers.get('content-type') },
      });

      busboy.on('file', async (fieldname, fileStream, { filename, mimeType: fileMimeType }) => {
        const name = decodeURIComponent(filename || '') || 'unknown';
        const mime = fileMimeType || 'application/octet-stream';
        fileName = name;
        writtenFilePath = join(targetDir, name);

        try {
          fileHandle = await open(writtenFilePath, 'w');
        } catch (err) {
          fileStream.resume(); // drain the stream
          return reject(err);
        }

        let sz = 0;

        fileStream.on('data', (chunk) => {
          fileStream.pause();
          fileHandle.write(chunk).then(() => {
            sz += chunk.length;
            fileStream.resume();
          }).catch((err) => {
            fileStream.destroy();
            reject(err);
          });
        });

        fileStream.on('end', () => {
          resolved = true;
          resolve({ fileName: name, size: sz, mimeType: mime });
        });

        fileStream.on('error', reject);
      });

      busboy.on('error', reject);
      busboy.on('finish', () => {
        if (!resolved) reject(new Error('No file provided in form data'));
      });

      nodeStream.pipe(busboy);
    });

    await fileHandle.close();
    fileHandle = null;

    logger.debug('POST /api/files/upload - Processing file', {
      fileName,
      fileSize: size,
      fileType: mimeType,
      path: relativePath,
      user: session.user.email,
    });

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/upload - File uploaded successfully', {
      fileName,
      fileSize: size,
      path: relativePath,
      duration: `${duration}ms`,
    });

    const normalizedFilePath = writtenFilePath.replace(/\\/g, '/').replace(new RegExp(`^${UPLOAD_DIR.replace(/\\/g, '/')}/`), '');

    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: fileName,
        size,
        mimeType,
        path: normalizedFilePath,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('POST /api/files/upload - Upload failed', error);
    logger.error('POST /api/files/upload - Error details', {
      fileName,
      duration: `${duration}ms`,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  } finally {
    // Close file handle if still open
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {}
    }
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
