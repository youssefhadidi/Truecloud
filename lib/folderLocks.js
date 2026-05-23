/** @format */

import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { prisma } from './prisma';

// 4-digit keyspace is tiny, so cap throughput aggressively. After 3 failures,
// each subsequent miss doubles the lockout window. Mirrors the session-lock
// PIN behavior in app/api/account/verify-pin/route.js.
const FAILURE_GRACE = 3;
const BASE_LOCKOUT_MS = 30 * 1000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

function computeLockoutMs(failures) {
  if (failures <= FAILURE_GRACE) return 0;
  const exponent = failures - FAILURE_GRACE - 1;
  return Math.min(BASE_LOCKOUT_MS * Math.pow(2, exponent), MAX_LOCKOUT_MS);
}

export function isLockableRootFolder(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.includes('/') || path.includes('\\')) return false;
  if (path === 'trash') return false;
  if (path.startsWith('user_')) return false;
  if (path.startsWith('.')) return false;
  return true;
}

// Returns the root segment of a request path, or '' for root.
export function getRootSegment(relativePath) {
  if (!relativePath) return '';
  return relativePath.split(/[/\\]/)[0] || '';
}

export async function getFolderLock(path) {
  if (!path) return null;
  return prisma.folderLock.findUnique({ where: { path } });
}

export async function lockedRootFolderPaths() {
  const rows = await prisma.folderLock.findMany({ select: { path: true } });
  return new Set(rows.map((r) => r.path));
}

// Verify a PIN against a folder's stored hash. Updates pinFailures /
// pinLockedUntil on the FolderLock row. Returns:
//   { ok: true }                                  // success
//   { ok: false, lockedOut: true, retryAfter }    // currently in lockout window
//   { ok: false }                                 // wrong PIN, no lockout yet
//   { ok: false, missing: true }                  // no lock for this path
export async function verifyFolderPin(path, pin) {
  if (!pin || typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin)) {
    return { ok: false, badFormat: true };
  }

  const lock = await prisma.folderLock.findUnique({ where: { path } });
  if (!lock) return { ok: false, missing: true };

  const now = Date.now();
  if (lock.pinLockedUntil && new Date(lock.pinLockedUntil).getTime() > now) {
    return {
      ok: false,
      lockedOut: true,
      retryAfter: Math.ceil((new Date(lock.pinLockedUntil).getTime() - now) / 1000),
    };
  }

  const isValid = await bcryptjs.compare(pin, lock.pinHash);

  if (!isValid) {
    const failures = (lock.pinFailures || 0) + 1;
    const lockoutMs = computeLockoutMs(failures);
    const lockedUntil = lockoutMs > 0 ? new Date(now + lockoutMs) : null;
    await prisma.folderLock.update({
      where: { path },
      data: { pinFailures: failures, pinLockedUntil: lockedUntil },
    });
    if (lockoutMs > 0) {
      return { ok: false, lockedOut: true, retryAfter: Math.ceil(lockoutMs / 1000) };
    }
    return { ok: false };
  }

  // Success — reset the failure counter.
  if (lock.pinFailures > 0 || lock.pinLockedUntil) {
    await prisma.folderLock.update({
      where: { path },
      data: { pinFailures: 0, pinLockedUntil: null },
    });
  }
  return { ok: true };
}

// Gate any file-API route by the lock on the request's root folder segment.
// Returns null when access is allowed (no lock, or PIN verified). Returns a
// NextResponse when the caller must short-circuit. The PIN travels as the
// `X-Folder-Pin` request header so it never lands in URLs or server logs.
export async function requireFolderUnlock(req, relativePath) {
  const root = getRootSegment(relativePath);
  if (!isLockableRootFolder(root)) return null;

  const lock = await prisma.folderLock.findUnique({
    where: { path: root },
    select: { id: true, pinLockedUntil: true },
  });
  if (!lock) return null;

  const pin = req.headers.get('x-folder-pin');
  if (!pin) {
    return NextResponse.json(
      { error: 'pin_required', path: root },
      { status: 423 },
    );
  }

  const result = await verifyFolderPin(root, pin);
  if (result.ok) return null;

  if (result.lockedOut) {
    return NextResponse.json(
      { error: 'pin_locked_out', path: root, retryAfter: result.retryAfter },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }
  return NextResponse.json({ error: 'pin_incorrect', path: root }, { status: 401 });
}
