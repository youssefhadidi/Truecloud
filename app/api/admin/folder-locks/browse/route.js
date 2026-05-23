/** @format */

import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { requireAdmin } from '@/lib/authCheck';
import { logger } from '@/lib/logger';
import { normalizeLockPath, isLockablePath, getAllLockedPaths, findAncestorLockPath, findDescendantLockPaths } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET /api/admin/folder-locks/browse?path=<rel>
// Admin-only folder-tree walker used by the Security UI's folder picker.
// Bypasses requireFolderUnlock on purpose — folder *names* aren't the secret;
// folder *contents* are. This lets the admin pick a path to lock without
// having to know existing PINs. Returns folder names only.
//
// Each entry is annotated with:
//   - isLockable:    structurally eligible (not trash, not user_*, not empty)
//   - hasAncestorLock:  this folder lives inside an already-locked tree
//   - hasDescendantLock: this folder contains a locked sub-folder
//   - isLocked:      this folder itself is the lock target
// The page uses these flags to disable invalid picks rather than to gate IO.
export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const rawPath = searchParams.get('path') || '';
    const relativePath = normalizeLockPath(rawPath);

    const targetDir = join(UPLOAD_DIR, relativePath);
    const resolvedTarget = resolve(targetDir) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    let entries;
    try {
      entries = await readdir(targetDir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'ENOENT') return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
      throw err;
    }

    const lockedPaths = await getAllLockedPaths();
    const lockedSet = new Set(lockedPaths);

    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .filter((e) => {
        // Hide trash + private user folders at root — never lockable anyway.
        if (!relativePath) {
          if (e.name === 'trash') return false;
          if (e.name.startsWith('user_')) return false;
        }
        return true;
      })
      .map((e) => {
        const fullPath = relativePath ? `${relativePath}/${e.name}` : e.name;
        return {
          name: e.name,
          path: fullPath,
          isLockable: isLockablePath(fullPath),
          isLocked: lockedSet.has(fullPath),
          hasAncestorLock: !!findAncestorLockPath(fullPath, lockedPaths) && !lockedSet.has(fullPath),
          hasDescendantLock: findDescendantLockPaths(fullPath, lockedPaths).length > 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Compute properties for the current path too, so the picker can decide
    // whether to enable a "Lock here" button at the breadcrumb level.
    const currentLockable = isLockablePath(relativePath);
    const currentAncestor = currentLockable ? findAncestorLockPath(relativePath, lockedPaths) : null;
    const currentDescendants = currentLockable ? findDescendantLockPaths(relativePath, lockedPaths) : [];

    return NextResponse.json({
      path: relativePath,
      folders,
      current: {
        isLockable: currentLockable,
        isLocked: currentLockable && lockedSet.has(relativePath),
        hasAncestorLock: !!currentAncestor && !lockedSet.has(relativePath),
        hasDescendantLock: currentDescendants.length > 0,
        ancestorLockPath: currentAncestor,
        descendantLockPath: currentDescendants[0] || null,
      },
    });
  } catch (err) {
    logger.error('GET /api/admin/folder-locks/browse - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
