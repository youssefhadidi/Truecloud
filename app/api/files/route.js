/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { readdir, stat, rm, unlink, rename, mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { getActiveDownloads, getWaitingDownloads } from '@/lib/torrentClient';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';
import { Semaphore } from '@/lib/semaphore.mjs';
import { requireFolderUnlock, lockedRootFolderPaths } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
// Pre-resolve the upload directory with trailing separator for proper security checks
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
// Semaphore to limit concurrent file stat calls (prevent overwhelming NAS/network storage)
const statSemaphore = new Semaphore(20);

// GET - List files
export async function GET(req) {
  const startTime = Date.now();
  try {
    logger.info('GET /api/files - Listing files');
    const { session, error } = await requireAuth();
    if (error) return error;

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

    if (relativePath.startsWith('user_')) {
      // Accessing a user's private folder — check ownership before any IO.
      const userIdFromPath = relativePath.split('/')[0].replace('user_', '');
      if (session.user.id !== userIdFromPath && session.user.role !== 'admin') {
        logger.warn('GET /api/files - Access denied to private folder', {
          requestedPath: relativePath,
          userId: session.user.id,
          userEmail: session.user.email,
          folderOwnerId: userIdFromPath,
        });
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Folder lock gate: admins set a PIN on root-level shared folders.
    // Sub-paths inherit the lock (Documents/Reports gated by lock on Documents).
    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const targetDir = join(UPLOAD_DIR, relativePath);

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

    // Kick off the torrent service call in parallel with the directory walk.
    // Why: today readdir → stat-all → fetch downloads ran sequentially, so the
    // torrent service latency was always on the critical path. Overlapping it
    // with the filesystem work hides it under the slower of the two.
    const downloadsPromise = (async () => {
      try {
        const [active, waiting] = await Promise.all([
          getActiveDownloads(relativePath),
          getWaitingDownloads(0, 100, relativePath),
        ]);
        return [...active, ...waiting];
      } catch (downloadError) {
        logger.warn('GET /api/files - Error fetching downloads', {
          path: relativePath,
          error: downloadError.message,
        });
        return [];
      }
    })();

    // Read entries with file types so we can filter without statting first.
    const entries = await readdir(targetDir, { withFileTypes: true });

    // Resolve downloads before the stat fan-out so we can pre-filter the
    // entries that would have been dropped anyway. Each skipped entry is one
    // saved stat() syscall — significant on large folders / network storage.
    const downloads = await downloadsPromise;
    const downloadingNames = new Set(
      downloads
        .filter((d) => d.status === 'active' || d.status === 'paused')
        .map((d) => d.name),
    );

    // Windows-generated system files that clutter listings without ever being
    // user content. Filtered pre-stat so we never pay for them.
    const HIDDEN_NAMES = new Set(['Thumbs.db', 'Thumbs.db:encryptable', 'desktop.ini']);
    const isAdmin = session.user.role === 'admin';
    const atRoot = !relativePath;

    const visibleEntries = entries.filter((entry) => {
      const name = entry.name;
      if (name.startsWith('.')) return false;
      if (HIDDEN_NAMES.has(name)) return false;
      if (downloadingNames.has(name)) return false;
      if (atRoot) {
        if (name === 'trash') return false;
        // Non-admin users only see their own user_ folder at root.
        if (!isAdmin && name.startsWith('user_')) {
          return name.replace('user_', '') === session.user.id;
        }
      }
      return true;
    });

    // Batch user lookup against the already-filtered set (skips lookups for
    // user_* folders that a non-admin caller can't see).
    const userIdsToLookup = atRoot
      ? visibleEntries
          .filter((e) => e.name.startsWith('user_'))
          .map((e) => e.name.replace('user_', ''))
      : [];

    const userLookupPromise = userIdsToLookup.length > 0
      ? prisma.user
          .findMany({
            where: { id: { in: userIdsToLookup } },
            select: { id: true, username: true },
          })
          .then((users) => Object.fromEntries(users.map((u) => [u.id, u.username])))
          .catch((e) => {
            logger.warn('GET /api/files - Failed to batch fetch users', { error: e.message });
            return {};
          })
      : Promise.resolve({});

    // At root we also need the set of locked folder paths to flag entries with
    // a 🔒 badge in the UI. Runs in parallel with the stat fan-out.
    const lockedPathsPromise = atRoot ? lockedRootFolderPaths() : Promise.resolve(null);

    // Stat the surviving entries with the existing concurrency limit. The
    // user lookup runs in parallel because it's an independent DB query.
    const [userMap, lockedPaths, files] = await Promise.all([
      userLookupPromise,
      lockedPathsPromise,
      Promise.all(
        visibleEntries.map(async (entry) => {
          await statSemaphore.acquire();
          try {
            const name = entry.name;
            const filePath = join(targetDir, name);
            const stats = await stat(filePath);

            // Normalize path for the frontend: hide the uploads/ prefix only,
            // preserve user_123/ and all sub-folder structure.
            const normalizedPath = filePath.replace(/\\/g, '/').replace(/^uploads\//, '');

            return {
              id: name,
              name,
              displayName: name, // overridden below for user_* folders once userMap resolves
              path: normalizedPath,
              size: stats.size,
              isDirectory: stats.isDirectory(),
              createdAt: stats.birthtime,
              updatedAt: stats.mtime,
            };
          } finally {
            statSemaphore.release();
          }
        }),
      ),
    ]);

    // Patch displayName for user folders now that userMap is resolved.
    if (atRoot && userIdsToLookup.length > 0) {
      for (const file of files) {
        if (file.name.startsWith('user_')) {
          const username = userMap[file.name.replace('user_', '')];
          if (username) file.displayName = `📁 ${username} (Private)`;
        }
      }
    }

    // Mark locked root folders so the UI can show a 🔒 badge and open the
    // PIN modal instead of navigating directly.
    if (atRoot && lockedPaths && lockedPaths.size > 0) {
      for (const file of files) {
        if (file.isDirectory && lockedPaths.has(file.name)) {
          file.locked = true;
        }
      }
    }

    // Note: Sorting is handled on the frontend (useFilesPage.js) based on user preference
    // This avoids redundant CPU usage and allows dynamic sorting without additional API calls

    const duration = Date.now() - startTime;
    logger.info('GET /api/files - Success', {
      path: relativePath,
      fileCount: files.length,
      downloadCount: downloads.length,
      duration: `${duration}ms`,
    });

    return NextResponse.json({ files, downloads });
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

// Helper to check if a path is in the trash
const isInTrash = (path) => path === 'trash' || path.startsWith('trash/') || path.startsWith('trash\\');

// DELETE - Delete file or directory (moves to trash, or permanently deletes if already in trash)
export async function DELETE(req) {
  const startTime = Date.now();
  try {
    logger.info('DELETE /api/files - Delete request');
    const { session, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    let relativePath = searchParams.get('path') || '';
    const fileName = searchParams.get('id');
    const permanent = searchParams.get('permanent') === 'true';

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

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

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

    // Determine if we should permanently delete or move to trash
    const inTrash = isInTrash(relativePath);
    const shouldPermanentDelete = inTrash || permanent;

    if (shouldPermanentDelete) {
      // Permanent delete (already in trash or forced)
      logger.debug('DELETE /api/files - Permanently deleting', {
        path: relativePath,
        fileName,
        user: session.user.email,
      });

      if (stats.isDirectory()) {
        await rm(targetPath, { recursive: true, force: true });
        logger.info('DELETE /api/files - Directory permanently deleted', {
          fileName,
          path: relativePath,
          duration: `${Date.now() - startTime}ms`,
        });
      } else {
        await unlink(targetPath);
        logger.info('DELETE /api/files - File permanently deleted', {
          fileName,
          path: relativePath,
          duration: `${Date.now() - startTime}ms`,
        });
      }

      // Broadcast file change
      broadcastFileChange('delete', relativePath, fileName, session.user.id);

      return NextResponse.json({ success: true, permanent: true });
    } else {
      // Move to trash (mirror the folder structure)

      // Construct trash path: /trash/{original_path}/{filename}
      const trashPath = join(UPLOAD_DIR, 'trash', relativePath, fileName);
      const trashDir = join(UPLOAD_DIR, 'trash', relativePath);

      // Security: ensure trash path is still within upload dir
      const resolvedTrashPath = resolve(trashPath) + sep;
      if (!resolvedTrashPath.startsWith(RESOLVED_UPLOAD_DIR)) {
        logger.error('DELETE /api/files - Trash path traversal attempt', {
          fileName,
          trashPath: resolvedTrashPath,
          user: session.user.email,
        });
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      // Create trash directory structure if it doesn't exist
      if (!existsSync(trashDir)) {
        await mkdir(trashDir, { recursive: true });
      }

      // If file already exists in trash, add timestamp to avoid overwriting
      let finalTrashPath = trashPath;
      if (existsSync(trashPath)) {
        const timestamp = Date.now();
        const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName;
        finalTrashPath = join(trashDir, `${nameWithoutExt}_${timestamp}${ext}`);
      }

      // Move file to trash (fall back to copy+delete for cross-device moves)
      try {
        await rename(targetPath, finalTrashPath);
      } catch (renameError) {
        if (renameError.code === 'EXDEV') {
          // Cross-device: copy then remove original
          logger.info('DELETE /api/files - Cross-device move, using cp+rm fallback', { fileName, path: relativePath });
          await cp(targetPath, finalTrashPath, { recursive: true, preserveTimestamps: true });
          await rm(targetPath, { recursive: true, force: true });
        } else {
          logger.error('DELETE /api/files - Failed to move to trash', {
            message: renameError.message,
            code: renameError.code,
            source: targetPath,
            destination: finalTrashPath,
            fileName,
            path: relativePath,
          });
          return NextResponse.json({ error: `Failed to move to trash: ${renameError.code || renameError.message}` }, { status: 500 });
        }
      }

      logger.info('DELETE /api/files - Moved to trash', {
        fileName,
        originalPath: relativePath,
        trashPath: finalTrashPath.replace(UPLOAD_DIR, ''),
        duration: `${Date.now() - startTime}ms`,
      });

      // Broadcast file change
      broadcastFileChange('delete', relativePath, fileName, session.user.id);

      return NextResponse.json({ success: true, movedToTrash: true });
    }
  } catch (error) {
    const { searchParams } = new URL(req.url);
    logger.error('DELETE /api/files - Error deleting file', {
      message: error.message,
      code: error.code,
      path: searchParams.get('path') || '',
      fileName: searchParams.get('id'),
      stack: error.stack,
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
    const { session, error } = await requireAuth();
    if (error) return error;

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

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

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
    await rename(oldPath, newPath);

    const duration = Date.now() - startTime;
    logger.info('PATCH /api/files - File renamed successfully', {
      oldName,
      newName,
      path: relativePath,
      duration: `${duration}ms`,
    });

    // Broadcast file change (rename)
    broadcastFileChange('rename', relativePath, newName, session.user.id);

    return NextResponse.json({ success: true, newName });
  } catch (error) {
    logger.error('PATCH /api/files - Error renaming file', error);
    logger.error('PATCH /api/files - Request details', {
      duration: `${Date.now() - startTime}ms`,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
