/** @format */

import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { stat } from 'fs/promises';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isLockableRootFolder } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// GET /api/admin/folder-locks
// Returns all currently-set folder locks. PIN hash is never exposed.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const locks = await prisma.folderLock.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        path: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        pinFailures: true,
        pinLockedUntil: true,
      },
    });

    // Resolve creator usernames in one round-trip.
    const creatorIds = [...new Set(locks.map((l) => l.createdById))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, username: true },
        })
      : [];
    const creatorMap = Object.fromEntries(creators.map((u) => [u.id, u.username]));

    return NextResponse.json({
      locks: locks.map((l) => ({
        ...l,
        createdByUsername: creatorMap[l.createdById] || null,
      })),
    });
  } catch (err) {
    logger.error('GET /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/folder-locks
// Body: { path, pin }. Creates or replaces the lock on a root folder.
// Replacement is admin-only (no currentPin gate) — the agreed recovery path.
export async function POST(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const { path, pin } = body || {};

    if (!isLockableRootFolder(path)) {
      return NextResponse.json(
        { error: 'Path must be a single root folder (no slashes, not trash, not user_*)' },
        { status: 400 },
      );
    }
    if (typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be a 4-digit number' }, { status: 400 });
    }

    // Folder must actually exist on disk — locking a non-existent path is
    // pointless and would silently break the admin UI's idea of "lockable".
    try {
      const st = await stat(join(UPLOAD_DIR, path));
      if (!st.isDirectory()) {
        return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Folder does not exist' }, { status: 404 });
    }

    const pinHash = await bcryptjs.hash(pin, 10);

    const lock = await prisma.folderLock.upsert({
      where: { path },
      create: { path, pinHash, createdById: session.user.id },
      update: { pinHash, createdById: session.user.id, pinFailures: 0, pinLockedUntil: null },
      select: { id: true, path: true, createdAt: true, updatedAt: true },
    });

    logger.info('POST /api/admin/folder-locks - Lock set', { path, by: session.user.email });

    return NextResponse.json({ lock });
  } catch (err) {
    logger.error('POST /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
