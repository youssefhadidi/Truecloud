/** @format */

import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isLockableRootFolder } from '@/lib/folderLocks';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';

// PUT /api/admin/folder-locks/[path]
// Body: { pin }. Replaces the PIN on an existing lock.
export async function PUT(req, { params }) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const resolvedParams = await params;
    const path = safeDecodeURIComponent(resolvedParams.path);

    if (!isLockableRootFolder(path)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 });
    }

    const body = await req.json();
    const { pin } = body || {};
    if (typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be a 4-digit number' }, { status: 400 });
    }

    const existing = await prisma.folderLock.findUnique({ where: { path } });
    if (!existing) {
      return NextResponse.json({ error: 'Lock not found' }, { status: 404 });
    }

    const pinHash = await bcryptjs.hash(pin, 10);
    await prisma.folderLock.update({
      where: { path },
      data: { pinHash, pinFailures: 0, pinLockedUntil: null, createdById: session.user.id },
    });

    logger.info('PUT /api/admin/folder-locks - PIN changed', { path, by: session.user.email });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('PUT /api/admin/folder-locks/[path] - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/folder-locks/[path]
// Removes a lock entirely. Folder becomes openable to anyone with file access.
export async function DELETE(req, { params }) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const resolvedParams = await params;
    const path = safeDecodeURIComponent(resolvedParams.path);

    if (!isLockableRootFolder(path)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 });
    }

    await prisma.folderLock.deleteMany({ where: { path } });

    logger.info('DELETE /api/admin/folder-locks - Lock removed', { path, by: session.user.email });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/admin/folder-locks/[path] - Error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
