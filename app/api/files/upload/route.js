/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import formidable from 'formidable';
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

    // Use formidable directly with the Web request object
    // Formidable can work with Web API Request objects natively
    const form = formidable({
      uploadDir: targetDir,
      keepExtensions: true,
      multiples: false,
      maxFileSize: 100 * 1024 * 1024 * 1024, // 100GB limit
      filename: (_, __, info) => {
        // Use the original filename sent by the client
        return info.originalFilename || `upload_${Date.now()}`;
      },
    });

    // Add debugging for file events
    form.on('file', (fieldname, file) => {
      logger.info('DEBUG: Formidable file event', {
        fieldname,
        originalFilename: file.originalFilename,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
      });
    });

    form.on('error', (err) => {
      logger.error('DEBUG: Formidable error event', {
        message: err.message,
        code: err.code,
      });
    });

    // Parse the multipart form - formidable handles streaming automatically
    const { fileSize, fileMimeType } = await new Promise((resolve, reject) => {
      form.parse(req, (err, _, files) => {
        if (err) {
          logger.error('POST /api/files/upload - Parse error', {
            message: err.message,
            code: err.code,
            stack: err.stack,
          });
          reject(err);
          return;
        }

        logger.info('DEBUG: Parse callback - files object:', {
          fileKeys: Object.keys(files || {}),
          fileCount: files?.file?.length || 0,
        });

        const uploadedFiles = files.file;
        if (!uploadedFiles || uploadedFiles.length === 0) {
          logger.warn('DEBUG: No files in parsed data', {
            allKeys: Object.keys(files || {}),
          });
          reject(new Error('No file provided in multipart data'));
          return;
        }

        const uploadedFile = uploadedFiles[0];
        fileName = uploadedFile.originalFilename || 'unknown';
        writtenFilePath = uploadedFile.filepath;

        logger.info('DEBUG: File parsed successfully', {
          originalFilename: uploadedFile.originalFilename,
          filename: uploadedFile.filename,
          filepath: uploadedFile.filepath,
          size: uploadedFile.size,
          mimetype: uploadedFile.mimetype,
        });

        resolve({
          fileSize: uploadedFile.size,
          fileMimeType: uploadedFile.mimetype || 'application/octet-stream',
        });
      });
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
