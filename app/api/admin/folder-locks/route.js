/** @format */

import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  isLockablePath,
  normalizeLockPath,
  getAllLockedPaths,
  findAncestorLockPath,
  findDescendantLockPaths,
} from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET /api/admin/folder-locks — list all locks. PIN hashes are never returned.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const locks = await prisma.folderLock.findMany({
      orderBy: { path: 'asc' },
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

    const creatorIds = [...new Set(locks.map((l) => l.createdById))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, username: true },
        })
      : [];
    const creatorMap = Object.fromEntries(creators.map((u) => [u.id, u.username]));

    return NextResponse.json({
      locks: locks.map((l) => ({ ...l, createdByUsername: creatorMap[l.createdById] || null })),
    });
  } catch (err) {
    logger.error('GET /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Verify the on-disk folder exists AND lives under UPLOAD_DIR (no traversal).
async function ensureFolderExists(relativePath) {
  const targetDir = join(UPLOAD_DIR, relativePath);
  const resolvedTarget = resolve(targetDir) + sep;
  if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
    return { ok: false, status: 400, error: 'Invalid path' };
  }
  try {
    const st = await stat(targetDir);
    if (!st.isDirectory()) return { ok: false, status: 400, error: 'Path is not a directory' };
  } catch {
    return { ok: false, status: 404, error: 'Folder does not exist' };
  }
  return { ok: true };
}

function badPin(pin) {
  return typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin);
}

// POST /api/admin/folder-locks — body: { path, pin }. Creates a new lock.
// Rejects nested-lock conflicts (no ancestor or descendant may already exist).
export async function POST(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const path = normalizeLockPath(body?.path);
    const { pin } = body || {};

    if (!isLockablePath(path)) {
      return NextResponse.json(
        { error: 'Path is not lockable (cannot be empty, trash, or a user_* folder)' },
        { status: 400 },
      );
    }
    if (badPin(pin)) {
      return NextResponse.json({ error: 'PIN must be a 4-digit number' }, { status: 400 });
    }

    const existing = await getAllLockedPaths();
    if (existing.includes(path)) {
      return NextResponse.json({ error: 'This folder is already locked' }, { status: 409 });
    }
    const ancestor = findAncestorLockPath(path, existing);
    if (ancestor) {
      return NextResponse.json(
        { error: `Cannot lock a folder inside an already-locked folder ("${ancestor}")` },
        { status: 409 },
      );
    }
    const descendants = findDescendantLockPaths(path, existing);
    if (descendants.length > 0) {
      return NextResponse.json(
        { error: `Cannot lock — contains a locked folder ("${descendants[0]}")` },
        { status: 409 },
      );
    }

    const exists = await ensureFolderExists(path);
    if (!exists.ok) return NextResponse.json({ error: exists.error }, { status: exists.status });

    const pinHash = await bcryptjs.hash(pin, 10);
    const lock = await prisma.folderLock.create({
      data: { path, pinHash, createdById: session.user.id },
      select: { id: true, path: true, createdAt: true, updatedAt: true },
    });

    logger.info('POST /api/admin/folder-locks - Lock created', { path, by: session.user.email });
    return NextResponse.json({ lock });
  } catch (err) {
    logger.error('POST /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/admin/folder-locks — body: { path, pin }. Replaces the PIN on
// an existing lock (admin recovery path, no currentPin required).
export async function PATCH(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const path = normalizeLockPath(body?.path);
    const { pin } = body || {};

    if (!isLockablePath(path)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 });
    }
    if (badPin(pin)) {
      return NextResponse.json({ error: 'PIN must be a 4-digit number' }, { status: 400 });
    }

    const existing = await prisma.folderLock.findUnique({ where: { path } });
    if (!existing) return NextResponse.json({ error: 'Lock not found' }, { status: 404 });

    const pinHash = await bcryptjs.hash(pin, 10);
    await prisma.folderLock.update({
      where: { path },
      data: { pinHash, pinFailures: 0, pinLockedUntil: null, createdById: session.user.id },
    });

    logger.info('PATCH /api/admin/folder-locks - PIN changed', { path, by: session.user.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('PATCH /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/folder-locks — body: { path }. Removes a lock entirely.
export async function DELETE(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const path = normalizeLockPath(body?.path);
    if (!isLockablePath(path)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 });
    }

    const removed = await prisma.folderLock.deleteMany({ where: { path } });
    logger.info('DELETE /api/admin/folder-locks - Lock removed', {
      path,
      removed: removed.count,
      by: session.user.email,
    });
    return NextResponse.json({ ok: true, removed: removed.count });
  } catch (err) {
    logger.error('DELETE /api/admin/folder-locks - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
