/** @format */

import { NextResponse } from 'next/server';
import { unlink, rm } from 'fs/promises';
import { stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath, clientIpFromHeaders } from '@/lib/shareAuth';
import { logger } from '@/lib/logger';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';
import { isProtectedFromWrite, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function DELETE(req, { params }) {
  const startTime = Date.now();
  try {
    logger.info('DELETE /api/public/[token]/delete - Request received');

    const { token } = await params;
    const password = req.headers.get('x-share-password');
    const url = new URL(req.url);
    const fileName = url.searchParams.get('file');
    const subPath = url.searchParams.get('path') || '';

    if (!fileName) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 });
    }

    // Validate file name - no path traversal
    if (fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') {
      return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
    }

    // Verify share and password
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));
    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Check if deletions are allowed
    if (!share.allowEditing) {
      return NextResponse.json({ error: 'Deletions not allowed for this share' }, { status: 403 });
    }

    // Check if it's a directory share
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Cannot delete from file shares' }, { status: 400 });
    }

    // Validate path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Construct full file path
    const filePath = join(UPLOAD_DIR, pathCheck.fullPath, fileName);
    const resolvedFilePath = resolve(filePath) + sep;

    // Security: ensure file path is within upload directory
    if (!resolvedFilePath.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('DELETE /api/public/[token]/delete - Path traversal attempt', {
        filePath,
        token,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Refuse to delete a cache dir, anything inside one, or a folder holding one
    if (isProtectedFromWrite(filePath)) {
      logger.warn('DELETE /api/public/[token]/delete - Blocked delete of reserved cache path', {
        filePath,
        token,
      });
      return NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 });
    }

    // Prevent deleting the root shared folder itself
    const rootSharePath = resolve(join(UPLOAD_DIR, share.path, share.fileName));
    if (resolve(filePath) === rootSharePath) {
      return NextResponse.json({ error: 'Cannot delete the shared folder' }, { status: 403 });
    }

    // Check if file/folder exists and get stats
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Delete file or directory
    if (stats.isDirectory()) {
      await rm(filePath, { recursive: true, force: true });
      // Broadcast file change to all connected clients
      broadcastFileChange('delete', pathCheck.fullPath, fileName, `T-${token}`);
      logger.info('DELETE /api/public/[token]/delete - Directory deleted', {
        fileName,
        subPath,
        duration: `${Date.now() - startTime}ms`,
      });
    } else {
      await unlink(filePath);
      // Broadcast file change to all connected clients
      broadcastFileChange('delete', pathCheck.fullPath, fileName, `T-${token}`);
      logger.info('DELETE /api/public/[token]/delete - File deleted', {
        fileName,
        subPath,
        duration: `${Date.now() - startTime}ms`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/public/[token]/delete - Error', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
