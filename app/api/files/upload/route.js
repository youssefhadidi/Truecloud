/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream, mkdirSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';
import { PassThrough } from 'node:stream';
import formidable from 'formidable';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

/**
 * Convert a Web ReadableStream to a Node.js Readable stream reliably.
 * Readable.fromWeb() has backpressure bugs in Node 21 that can truncate data.
 */
function webStreamToNodeStream(webStream, headers) {
  const passthrough = new PassThrough();
  // Attach headers so formidable can read content-type / content-length
  passthrough.headers = headers;
  const reader = webStream.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          passthrough.end();
          break;
        }
        // Respect backpressure: if push returns false, wait for drain
        if (!passthrough.write(value)) {
          await new Promise((resolve) => passthrough.once('drain', resolve));
        }
      }
    } catch (err) {
      passthrough.destroy(err);
    }
  })();
  return passthrough;
}

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

    // Configure formidable to write directly to the target directory (no temp files)
    const form = formidable({
      maxFileSize: 200 * 1024 * 1024 * 1024, // 200 GB
      maxTotalFileSize: 200 * 1024 * 1024 * 1024,
      allowEmptyFiles: false,
      multiples: false,
      fileWriteStreamHandler: (file) => {
        const ext = extname(file.originalFilename || '').toLowerCase();
        isHeic = ['.heic', '.heif'].includes(ext);
        const targetDir = isHeic ? heicTargetDir : regularTargetDir;
        storedBaseDir = isHeic ? HEIC_DIR : UPLOAD_DIR;

        // Create HEIC target dir on demand (sync — this callback is synchronous)
        if (isHeic && !existsSync(heicTargetDir)) {
          mkdirSync(heicTargetDir, { recursive: true });
        }

        fileName = file.originalFilename || 'unknown';
        writtenFilePath = join(targetDir, fileName);
        return createWriteStream(writtenFilePath);
      },
    });

    // Stream request body directly to formidable → disk (no buffering in RAM)
    const headers = Object.fromEntries(req.headers.entries());
    const nodeStream = webStreamToNodeStream(req.body, headers);

    let files;
    try {
      [, files] = await form.parse(nodeStream);
    } catch (parseError) {
      logger.error('POST /api/files/upload - Streaming parse failed', {
        error: parseError.message,
      });
      return NextResponse.json({ error: 'Upload parsing failed', details: parseError.message }, { status: 400 });
    }

    const uploadedFile = files.file?.[0];
    if (!uploadedFile) {
      logger.warn('POST /api/files/upload - No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    logger.debug('POST /api/files/upload - Processing file', {
      fileName,
      fileSize: uploadedFile.size,
      fileType: uploadedFile.mimetype,
      path: relativePath,
      user: session.user.email,
    });

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/upload - File uploaded successfully', {
      fileName,
      fileSize: uploadedFile.size,
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
        size: uploadedFile.size,
        mimeType: uploadedFile.mimetype,
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
