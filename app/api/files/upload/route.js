/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, rename, unlink, copyFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
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
const TEMP_DIR = resolve(process.cwd(), '.upload-tmp');
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const RESOLVED_HEIC_DIR = resolve(process.cwd(), HEIC_DIR) + sep;

/**
 * Move a file, falling back to copy+delete if cross-device (EXDEV)
 */
async function moveFile(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await copyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}

export async function POST(req) {
  const startTime = Date.now();
  let fileName = 'unknown';
  let tempFilePath = null; // Track temp file for cleanup on error
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

    // Ensure directories exist
    for (const dir of [UPLOAD_DIR, HEIC_DIR, TEMP_DIR]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Convert Web Request body to Node.js stream for formidable (streams to disk, not RAM)
    const headers = Object.fromEntries(req.headers.entries());
    const nodeStream = webStreamToNodeStream(req.body, headers);

    const form = formidable({
      uploadDir: TEMP_DIR,
      keepExtensions: true,
      maxFileSize: 200 * 1024 * 1024 * 1024, // 200 GB
      maxTotalFileSize: 200 * 1024 * 1024 * 1024,
      allowEmptyFiles: false,
      multiples: false,
    });

    let fields, files;
    try {
      [fields, files] = await form.parse(nodeStream);
    } catch (parseError) {
      logger.error('POST /api/files/upload - Streaming parse failed', {
        error: parseError.message,
      });
      return NextResponse.json({ error: 'Upload parsing failed', details: parseError.message }, { status: 400 });
    }

    const uploadedFile = files.file?.[0];
    let relativePath = fields.path?.[0] || '';

    if (!uploadedFile) {
      logger.warn('POST /api/files/upload - No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    tempFilePath = uploadedFile.filepath;
    fileName = uploadedFile.originalFilename || 'unknown';

    // Check user permissions
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

    // Use normalized path (may be redirected)
    relativePath = accessCheck.normalizedPath;
    if (accessCheck.redirected) {
      logger.info('POST /api/files/upload - Redirected to personal folder', {
        userId: session.user.id,
        newPath: relativePath,
      });
    }

    logger.debug('POST /api/files/upload - Processing file', {
      fileName,
      fileSize: uploadedFile.size,
      fileType: uploadedFile.mimetype,
      path: relativePath,
      user: session.user.email,
    });

    // Check if file is HEIC/HEIF
    const fileExt = extname(fileName).toLowerCase();
    const isHeic = ['.heic', '.heif'].includes(fileExt);

    // Use HEIC directory for HEIC files, otherwise use uploads directory
    const baseDir = isHeic ? HEIC_DIR : UPLOAD_DIR;
    const resolvedBaseDir = isHeic ? RESOLVED_HEIC_DIR : RESOLVED_UPLOAD_DIR;

    // Ensure target directory exists
    const targetDir = join(baseDir, relativePath);
    if (!existsSync(targetDir)) {
      logger.debug('POST /api/files/upload - Creating target directory', { dir: targetDir });
      await mkdir(targetDir, { recursive: true });
    }

    // Security: prevent directory traversal
    if (!(resolve(targetDir) + sep).startsWith(resolvedBaseDir)) {
      logger.error('POST /api/files/upload - Directory traversal attempt', {
        targetDir,
        baseDir,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Move file from temp to final location (atomic on same filesystem)
    const filePath = join(targetDir, fileName);
    await moveFile(tempFilePath, filePath);
    tempFilePath = null; // Successfully moved, no cleanup needed

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/upload - File uploaded successfully', {
      fileName,
      fileSize: uploadedFile.size,
      path: relativePath,
      isHeic,
      storedIn: baseDir,
      duration: `${duration}ms`,
    });

    // Normalize path for frontend response (hide uploads/user_id/ prefix)
    const normalizedFilePath = filePath.replace(/\\/g, '/').replace(new RegExp(`^${baseDir.replace(/\\/g, '/')}/`), '');

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
    // Clean up temp file if it still exists (e.g. error after formidable wrote it)
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }
  }
}
