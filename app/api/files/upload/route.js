/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

// Allow large file uploads (set timeout to 30 minutes)
export const maxDuration = 1800;
export const runtime = 'nodejs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req) {
  const startTime = Date.now();
  let fileName = 'unknown';
  let writtenFilePath = null; // Track for cleanup on error
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

    const contentType = req.headers.get('content-type');
    const contentLength = req.headers.get('content-length');
    logger.info('POST /api/files/upload - Incoming request', {
      contentType,
      contentLength,
      path: relativePath,
    });

    const fileLimits = {
      files: 1,
      fileSize: 100 * 1024 * 1024 * 1024, // 100GB
    };

    if (!contentType || !contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Invalid content type' }, { status: 415 });
    }

    const { fileSize, fileMimeType } = await new Promise((resolve, reject) => {
      let aborted = false;
      let totalBytes = 0;
      const handleAbort = () => {
        aborted = true;
        reject(new Error('Client aborted upload'));
      };

      req.signal?.addEventListener('abort', handleAbort, { once: true });

      const busboy = Busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: fileLimits,
      });

      let fileMimeTypeLocal = 'application/octet-stream';
      let fileSizeLocal = 0;
      let fileReceived = false;
      let writePromise = null;

      busboy.on('file', (fieldname, file, info) => {
        if (fieldname !== 'file') {
          file.resume();
          return;
        }

        fileReceived = true;
        const originalName = info?.filename || `upload_${Date.now()}`;
        const safeName = originalName.split(/[/\\]/).pop() || `upload_${Date.now()}`;
        fileName = safeName;
        fileMimeTypeLocal = info?.mimeType || 'application/octet-stream';
        writtenFilePath = join(targetDir, safeName);

        const writeStream = createWriteStream(writtenFilePath);
        writePromise = new Promise((res, rej) => {
          writeStream.on('finish', res);
          writeStream.on('error', rej);
        });

        file.on('data', (chunk) => {
          fileSizeLocal += chunk.length;
        });

        file.on('limit', () => {
          const limitError = new Error('File too large');
          limitError.code = 'LIMIT_FILE_SIZE';
          writeStream.destroy(limitError);
          reject(limitError);
        });

        file.on('error', reject);
        file.pipe(writeStream);
      });

      busboy.on('error', reject);

      busboy.on('finish', async () => {
        try {
          if (aborted) {
            return;
          }
          if (!fileReceived) {
            reject(new Error('No file provided in multipart data'));
            return;
          }
          if (writePromise) {
            await writePromise;
          }
          resolve({ fileSize: fileSizeLocal, fileMimeType: fileMimeTypeLocal });
        } catch (finishError) {
          reject(finishError);
        }
      });

      const nodeStream = Readable.fromWeb(req.body);
      nodeStream.on('data', (chunk) => {
        totalBytes += chunk.length;
      });
      nodeStream.on('error', reject);
      nodeStream.on('close', () => {
        if (!fileReceived) {
          reject(new Error('Request stream closed before file was received'));
        }
      });
      nodeStream.on('end', () => {
        const expected = contentLength ? Number(contentLength) : null;
        if (expected !== null && totalBytes !== expected) {
          logger.error('POST /api/files/upload - Stream size mismatch', {
            expected,
            received: totalBytes,
          });
        }
      });
      nodeStream.pipe(busboy);
    });

    const size = fileSize;
    const mimeType = fileMimeType;
    logger.info('DEBUG: Parse complete, proceeding with upload', {
      fileName,
      size,
      mimeType,
    });

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
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
