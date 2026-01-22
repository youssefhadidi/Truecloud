/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { lookup } from 'mime-types';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
// Pre-resolve the upload directory with trailing separator for proper security checks
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET - List files
export async function GET(req) {
  const startTime = Date.now();
  try {
    logger.info('GET /api/files - Listing files');
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files - Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let relativePath = searchParams.get('path') || '';
    logger.debug('GET /api/files - Path requested', { path: relativePath, user: session.user.email });

    // Check user permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    logger.debug('GET /api/files - Access check result', {
      userId: session.user.id,
      requestedPath: relativePath,
      isRoot,
      accessCheck,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    // Use normalized path (may be redirected)
    relativePath = accessCheck.normalizedPath;
    if (accessCheck.redirected) {
      logger.info('GET /api/files - Redirected to personal folder', {
        userId: session.user.id,
        newPath: relativePath,
      });
    }

    // Determine base directory based on path
    let targetDir;
    let isPrivateFolder = false;

    if (relativePath.startsWith('user_')) {
      // Accessing a user's private folder
      targetDir = join(UPLOAD_DIR, relativePath);
      isPrivateFolder = true;

      // Extract user ID from path
      const pathParts = relativePath.split('/');
      const userFolderName = pathParts[0];
      const userIdFromPath = userFolderName.replace('user_', '');

      // Check if user has access (must be owner or admin)
      if (session.user.id !== userIdFromPath && session.user.role !== 'admin') {
        logger.warn('GET /api/files - Access denied to private folder', {
          requestedPath: relativePath,
          userId: session.user.id,
          userEmail: session.user.email,
          folderOwnerId: userIdFromPath,
        });
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    } else {
      // Accessing shared folder
      targetDir = join(UPLOAD_DIR, relativePath);
    }

    // Security: prevent directory traversal
    const resolvedTarget = resolve(targetDir) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('GET /api/files - Directory traversal attempt detected', {
        requestedPath: relativePath,
        resolvedTarget,
        resolvedUpload: RESOLVED_UPLOAD_DIR,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Read files from filesystem
    const fileNames = await readdir(targetDir);

    // Get file stats for each file
    let files = await Promise.all(
      fileNames.map(async (name) => {
        const filePath = join(targetDir, name);
        const stats = await stat(filePath);

        // Get user info for user folders to display username
        let displayName = name;
        if (!relativePath && name.startsWith('user_')) {
          const userId = name.replace('user_', '');
          try {
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { username: true },
            });
            if (user) {
              displayName = `📁 ${user.username} (Private)`;
            }
          } catch (e) {
            // If user not found, keep original name
          }
        }

        return {
          id: name, // Use filename as ID
          name: name,
          displayName: displayName,
          path: filePath.replace(/\\/g, '/'),
          size: stats.size,
          mimeType: lookup(name) || 'application/octet-stream',
          isDirectory: stats.isDirectory(),
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
        };
      }),
    );

    // Filter user folders at root level if not admin
    if (!relativePath && session.user.role !== 'admin') {
      files = files.filter((file) => {
        if (!file.name.startsWith('user_')) return true; // Show shared files/folders
        const userIdFromFolder = file.name.replace('user_', '');
        return userIdFromFolder === session.user.id; // Only show user's own folder
      });
    }

    // Normalize paths for frontend (hide uploads/user_id/ prefix)
    files = files.map((file) => {
      let normalizedPath = file.path.replace(/\\/g, '/');
      // Remove uploads/ or uploads/user_{id}/ prefix
      normalizedPath = normalizedPath.replace(/^uploads\/(?:user_[^/]+\/)?/, '');
      return {
        ...file,
        path: normalizedPath,
      };
    });

    // Sort: directories first, then by name
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const duration = Date.now() - startTime;
    logger.info('GET /api/files - Success', {
      path: relativePath,
      fileCount: files.length,
      duration: `${duration}ms`,
    });

    return NextResponse.json({ files });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files - Error fetching files', error);
    logger.error('GET /api/files - Request details', {
      duration: `${duration}ms`,
      url: req.url,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete file or directory
export async function DELETE(req) {
  const startTime = Date.now();
  try {
    logger.info('DELETE /api/files - Delete request');
    const session = await auth();
    if (!session) {
      logger.warn('DELETE /api/files - Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let relativePath = searchParams.get('path') || '';
    const fileName = searchParams.get('id');

    if (!fileName) {
      logger.warn('DELETE /api/files - Missing file name');
      return NextResponse.json({ error: 'File name required' }, { status: 400 });
    }

    // Check if user has root access
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'write',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('DELETE /api/files - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    // Use normalized path
    relativePath = accessCheck.normalizedPath;

    logger.debug('DELETE /api/files - Deleting file', {
      path: relativePath,
      fileName,
      user: session.user.email,
    });

    // Construct file path
    const targetPath = join(UPLOAD_DIR, relativePath, fileName);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(targetPath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('DELETE /api/files - Directory traversal attempt', {
        fileName,
        resolvedTarget,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if it's a directory or file
    const stats = await stat(targetPath);

    if (stats.isDirectory()) {
      // Delete directory recursively
      const { rm } = await import('fs/promises');
      await rm(targetPath, { recursive: true, force: true });
      logger.info('DELETE /api/files - Directory deleted', {
        fileName,
        path: relativePath,
        duration: `${Date.now() - startTime}ms`,
      });
    } else {
      // Delete file
      const { unlink } = await import('fs/promises');
      await unlink(targetPath);
      logger.info('DELETE /api/files - File deleted', {
        fileName,
        path: relativePath,
        duration: `${Date.now() - startTime}ms`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/files - Error deleting file', error);
    logger.error('DELETE /api/files - Request details', {
      duration: `${Date.now() - startTime}ms`,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Rename file or directory
export async function PATCH(req) {
  const startTime = Date.now();
  try {
    logger.info('PATCH /api/files - Rename request');
    const session = await auth();
    if (!session) {
      logger.warn('PATCH /api/files - Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let relativePath = searchParams.get('path') || '';
    const oldName = searchParams.get('id');
    const { newName } = await req.json();

    if (!oldName || !newName) {
      logger.warn('PATCH /api/files - Missing old or new name');
      return NextResponse.json({ error: 'Old and new names required' }, { status: 400 });
    }

    // Check if user has root access
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'write',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('PATCH /api/files - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    // Use normalized path
    relativePath = accessCheck.normalizedPath;

    logger.debug('PATCH /api/files - Renaming file', {
      oldName,
      newName,
      path: relativePath,
      user: session.user.email,
    });

    // Construct paths
    const oldPath = join(UPLOAD_DIR, relativePath, oldName);
    const newPath = join(UPLOAD_DIR, relativePath, newName);

    // Security: prevent directory traversal
    const resolvedOld = resolve(oldPath) + sep;
    const resolvedNew = resolve(newPath) + sep;

    if (!resolvedOld.startsWith(RESOLVED_UPLOAD_DIR) || !resolvedNew.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('PATCH /api/files - Directory traversal attempt', {
        oldName,
        newName,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Rename using fs.rename
    const { rename } = await import('fs/promises');
    await rename(oldPath, newPath);

    const duration = Date.now() - startTime;
    logger.info('PATCH /api/files - File renamed successfully', {
      oldName,
      newName,
      path: relativePath,
      duration: `${duration}ms`,
    });

    return NextResponse.json({ success: true, newName });
  } catch (error) {
    logger.error('PATCH /api/files - Error renaming file', error);
    logger.error('PATCH /api/files - Request details', {
      duration: `${Date.now() - startTime}ms`,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
