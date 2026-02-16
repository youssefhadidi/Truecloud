/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// POST - Restore file from trash
export async function POST(req) {
  const startTime = Date.now();
  try {
    logger.info('POST /api/files/restore - Restore request');
    const { session, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    let trashPath = searchParams.get('path') || '';
    const fileName = searchParams.get('id');

    if (!fileName) {
      logger.warn('POST /api/files/restore - Missing file name');
      return NextResponse.json({ error: 'File name required' }, { status: 400 });
    }

    // Verify the file is in trash
    if (!trashPath.startsWith('trash/') && trashPath !== 'trash') {
      logger.warn('POST /api/files/restore - File not in trash', { path: trashPath });
      return NextResponse.json({ error: 'File is not in trash' }, { status: 400 });
    }

    // Check if user has root access
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: trashPath,
      operation: 'write',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('POST /api/files/restore - Access denied', {
        requestedPath: trashPath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    // Use normalized path
    trashPath = accessCheck.normalizedPath;

    // Calculate original path by removing 'trash/' prefix
    const pathWithoutTrash = trashPath.replace(/^trash\/?/, '');
    const originalPath = pathWithoutTrash;

    logger.debug('POST /api/files/restore - Restoring file', {
      trashPath,
      originalPath,
      fileName,
      user: session.user.email,
    });

    // Construct paths
    const sourcePath = join(UPLOAD_DIR, trashPath, fileName);
    const destPath = join(UPLOAD_DIR, originalPath, fileName);
    const destDir = join(UPLOAD_DIR, originalPath);

    // Security: prevent directory traversal
    const resolvedSource = resolve(sourcePath) + sep;
    const resolvedDest = resolve(destPath) + sep;

    if (!resolvedSource.startsWith(RESOLVED_UPLOAD_DIR) || !resolvedDest.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/files/restore - Directory traversal attempt', {
        fileName,
        sourcePath: resolvedSource,
        destPath: resolvedDest,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if source exists
    try {
      await stat(sourcePath);
    } catch {
      logger.warn('POST /api/files/restore - Source file not found', { sourcePath });
      return NextResponse.json({ error: 'File not found in trash' }, { status: 404 });
    }

    const { rename, mkdir } = await import('fs/promises');
    const { existsSync } = await import('fs');

    // Create destination directory if it doesn't exist
    if (!existsSync(destDir)) {
      await mkdir(destDir, { recursive: true });
      logger.debug('POST /api/files/restore - Created destination directory', { destDir });
    }

    // If file already exists at destination, add timestamp
    let finalDestPath = destPath;
    if (existsSync(destPath)) {
      const timestamp = Date.now();
      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
      const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName;
      finalDestPath = join(destDir, `${nameWithoutExt}_restored_${timestamp}${ext}`);
    }

    // Move file from trash to original location (fall back to copy+delete for cross-device)
    try {
      await rename(sourcePath, finalDestPath);
    } catch (renameError) {
      if (renameError.code === 'EXDEV') {
        logger.info('POST /api/files/restore - Cross-device move, using cp+rm fallback', { fileName, trashPath, originalPath });
        const { cp, rm } = await import('fs/promises');
        await cp(sourcePath, finalDestPath, { recursive: true, preserveTimestamps: true });
        await rm(sourcePath, { recursive: true, force: true });
      } else {
        logger.error('POST /api/files/restore - Failed to restore', {
          message: renameError.message,
          code: renameError.code,
          source: sourcePath,
          destination: finalDestPath,
          fileName,
        });
        return NextResponse.json({ error: `Failed to restore: ${renameError.code || renameError.message}` }, { status: 500 });
      }
    }

    const restoredFileName = finalDestPath.split(sep).pop();

    logger.info('POST /api/files/restore - File restored', {
      fileName,
      restoredAs: restoredFileName,
      originalPath,
      duration: `${Date.now() - startTime}ms`,
    });

    // Broadcast file change (restore)
    broadcastFileChange('restore', originalPath, restoredFileName, session.user.id);

    return NextResponse.json({
      success: true,
      restoredTo: originalPath,
      fileName: restoredFileName,
    });
  } catch (error) {
    logger.error('POST /api/files/restore - Error restoring file', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
