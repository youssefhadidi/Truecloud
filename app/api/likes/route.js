/** @format */

import { NextResponse } from 'next/server';
import { join, resolve, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { requireAuth, requireAuthNoActivity } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

/**
 * Resolve a liked file's stored path to an absolute path on disk, enforcing
 * the caller's folder permissions. Returns null when the path is not readable
 * by this user or escapes the upload root.
 */
function resolveLikedPath(userId, isRoot, filePath) {
  const access = checkPathAccess({ userId, path: filePath, operation: 'read', isRootUser: isRoot });
  if (!access.allowed) return null;

  const uploadRoot = resolve(UPLOAD_DIR);
  const absolute = resolve(join(UPLOAD_DIR, access.normalizedPath));
  if (absolute !== uploadRoot && !absolute.startsWith(uploadRoot + sep)) return null;

  return absolute;
}

// GET - List the current user's liked files (newest first)
export async function GET() {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const liked = await prisma.likedFile.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });

    // A liked file can be deleted or moved from anywhere in the app, so report
    // whether each entry still points at a real file instead of leaving the
    // gallery to render broken thumbnails.
    const isRoot = await hasRootAccess(session.user.id);
    const withStatus = await Promise.all(
      liked.map(async (item) => {
        const absolute = resolveLikedPath(session.user.id, isRoot, item.path);
        if (!absolute) return { ...item, missing: true, size: null, modifiedAt: null };
        try {
          const stat = await fsPromises.stat(absolute);
          return {
            ...item,
            missing: false,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        } catch {
          return { ...item, missing: true, size: null, modifiedAt: null };
        }
      }),
    );

    return NextResponse.json({ liked: withStatus });
  } catch (error) {
    logger.error('GET /api/likes - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Like a file
export async function POST(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    const { path: filePath, name } = await req.json();

    if (!filePath || !name) {
      return NextResponse.json({ error: 'Path and name are required' }, { status: 400 });
    }

    const isRoot = await hasRootAccess(session.user.id);
    const absolute = resolveLikedPath(session.user.id, isRoot, filePath);
    if (!absolute) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Only files can be liked - folders belong in the sidebar favorites.
    let stat;
    try {
      stat = await fsPromises.stat(absolute);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Only files can be liked' }, { status: 400 });
    }

    const existing = await prisma.likedFile.findUnique({
      where: { path_ownerId: { path: filePath, ownerId: session.user.id } },
    });

    if (existing) {
      return NextResponse.json({ error: 'Already liked' }, { status: 409 });
    }

    const liked = await prisma.likedFile.create({
      data: { path: filePath, name, ownerId: session.user.id },
    });

    logger.info('POST /api/likes - File liked', { path: filePath, userId: session.user.id });
    return NextResponse.json({ liked });
  } catch (error) {
    logger.error('POST /api/likes - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Unlike a file (by id or path)
export async function DELETE(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const filePath = searchParams.get('path');

    if (!id && !filePath) {
      return NextResponse.json({ error: 'ID or path required' }, { status: 400 });
    }

    const deleted = await prisma.likedFile.deleteMany({
      where: id ? { id, ownerId: session.user.id } : { path: filePath, ownerId: session.user.id },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Liked file not found' }, { status: 404 });
    }

    logger.info('DELETE /api/likes - File unliked', { id, path: filePath, userId: session.user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/likes - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
