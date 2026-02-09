/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink, open } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';
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

    // File metadata comes from headers (body is raw binary, not multipart)
    fileName = decodeURIComponent(req.headers.get('x-file-name') || '') || 'unknown';
    const mimeType = req.headers.get('content-type') || 'application/octet-stream';

    // Track which directory the file goes to
    const ext = extname(fileName).toLowerCase();
    const isHeic = ['.heic', '.heif'].includes(ext);
    const targetDir = isHeic ? heicTargetDir : regularTargetDir;
    const storedBaseDir = isHeic ? HEIC_DIR : UPLOAD_DIR;

    // Create HEIC target dir on demand
    if (isHeic && !existsSync(heicTargetDir)) {
      mkdirSync(heicTargetDir, { recursive: true });
    }

    writtenFilePath = join(targetDir, fileName);

    if (!req.body) {
      logger.warn('POST /api/files/upload - No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Stream the raw body directly to disk — no multipart parsing needed
    const reader = req.body.getReader();
    fileHandle = await open(writtenFilePath, 'w');
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await fileHandle.write(value);
      size += value.length;
    }

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
      isHeic,
      storedIn: storedBaseDir,
      duration: `${duration}ms`,
    });

    const normalizedFilePath = writtenFilePath.replace(/\\/g, '/').replace(new RegExp(`^${storedBaseDir.replace(/\\/g, '/')}/`), '');

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
