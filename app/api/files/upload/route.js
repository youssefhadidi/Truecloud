/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream, mkdirSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

// Allow large file uploads (set timeout to 30 minutes)
export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = './heic'; // Separate directory for HEIC files
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const RESOLVED_HEIC_DIR = resolve(process.cwd(), HEIC_DIR) + sep;

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

    // Pre-compute both possible target directories
    const regularTargetDir = join(UPLOAD_DIR, relativePath);
    const heicTargetDir = join(HEIC_DIR, relativePath);

    // Security: prevent directory traversal
    if (!(resolve(regularTargetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/files/upload - Directory traversal attempt', {
        targetDir: regularTargetDir,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Ensure the regular target directory exists
    if (!existsSync(regularTargetDir)) {
      await mkdir(regularTargetDir, { recursive: true });
    }

    // Track which directory the file goes to
    let storedBaseDir = UPLOAD_DIR;
    let isHeic = false;

    // Parse multipart upload with busboy — streams file data directly to disk
    const contentType = req.headers.get('content-type') || '';
    const result = await new Promise((resolvePromise, rejectPromise) => {
      let fileInfo = null;
      let fileProcessed = false;

      const bb = Busboy({
        headers: { 'content-type': contentType },
        limits: { files: 1 },
      });

      bb.on('file', (fieldName, stream, { filename, mimeType }) => {
        if (fileProcessed) {
          stream.resume(); // Discard extra files
          return;
        }
        fileProcessed = true;

        fileName = filename || 'unknown';
        const ext = extname(fileName).toLowerCase();
        isHeic = ['.heic', '.heif'].includes(ext);
        const targetDir = isHeic ? heicTargetDir : regularTargetDir;
        storedBaseDir = isHeic ? HEIC_DIR : UPLOAD_DIR;

        // Create HEIC target dir on demand
        if (isHeic && !existsSync(heicTargetDir)) {
          mkdirSync(heicTargetDir, { recursive: true });
        }

        writtenFilePath = join(targetDir, fileName);
        let size = 0;

        const ws = createWriteStream(writtenFilePath);

        ws.on('error', (err) => {
          stream.resume();
          rejectPromise(err);
        });

        stream.on('data', (chunk) => {
          size += chunk.length;
        });

        stream.pipe(ws);

        stream.on('end', () => {
          fileInfo = { name: fileName, size, mimeType: mimeType || 'application/octet-stream' };
        });

        stream.on('error', (err) => {
          ws.destroy();
          rejectPromise(err);
        });
      });

      bb.on('finish', () => {
        if (!fileInfo) {
          rejectPromise(new Error('No file provided'));
        } else {
          resolvePromise(fileInfo);
        }
      });

      bb.on('error', (err) => {
        rejectPromise(err);
      });

      // Pipe the Web ReadableStream into busboy via Readable.fromWeb
      const nodeStream = Readable.fromWeb(req.body);
      nodeStream.on('error', (err) => {
        bb.destroy(err);
      });
      nodeStream.pipe(bb);
    });

    logger.debug('POST /api/files/upload - Processing file', {
      fileName,
      fileSize: result.size,
      fileType: result.mimeType,
      path: relativePath,
      user: session.user.email,
    });

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/upload - File uploaded successfully', {
      fileName,
      fileSize: result.size,
      path: relativePath,
      isHeic,
      storedIn: storedBaseDir,
      duration: `${duration}ms`,
    });

    const normalizedFilePath = writtenFilePath.replace(/\\/g, '/').replace(new RegExp(`^${storedBaseDir.replace(/\\/g, '/')}/`), '');

    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: result.name,
        size: result.size,
        mimeType: result.mimeType,
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
    const message = error.message || 'Upload failed';
    const status = message === 'No file provided' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
