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

// Normalize a relative file-tree path: forward slashes only, no leading/
// trailing slashes, no dot segments. We keep this strict so equality and
// startsWith comparisons against stored lock paths are reliable.
export function normalizeLockPath(path) {
  if (typeof path !== 'string') return '';
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

// Whether `path` is structurally eligible to receive a folder lock. Allows
// any depth, but rejects empty paths, the trash tree, and per-user private
// folders (those have their own ownership/permission model).
export function isLockablePath(path) {
  const n = normalizeLockPath(path);
  if (!n) return false;
  const head = n.split('/')[0];
  if (head === 'trash') return false;
  if (head.startsWith('user_')) return false;
  if (head.startsWith('.')) return false;
  return true;
}

// True if `ancestor` is `descendant` itself or a strict ancestor of it.
function isAncestorOf(ancestor, descendant) {
  if (!ancestor) return false;
  if (ancestor === descendant) return true;
  return descendant.startsWith(ancestor + '/');
}

// Find the lock whose path is the nearest ancestor of `path` (or === path).
// Caller usually has the full lock list already; this keeps the search O(n)
// and order-independent.
export function findAncestorLockPath(path, lockedPaths) {
  const n = normalizeLockPath(path);
  if (!n) return null;
  let best = null;
  for (const lp of lockedPaths) {
    if (!isAncestorOf(lp, n)) continue;
    if (best === null || lp.length > best.length) best = lp;
  }
  return best;
}

export function findDescendantLockPaths(path, lockedPaths) {
  const n = normalizeLockPath(path);
  if (!n) return lockedPaths.slice(); // empty = root, everything is a descendant
  return lockedPaths.filter((lp) => lp !== n && lp.startsWith(n + '/'));
}

export async function getAllLockedPaths() {
  const rows = await prisma.folderLock.findMany({ select: { path: true } });
  return rows.map((r) => r.path);
}

// Verify a 4-digit PIN against the lock stored under `lockPath`. Mutates the
// row's pinFailures / pinLockedUntil with the same exponential-backoff
// schedule as the session-lock PIN.
export async function verifyFolderPin(lockPath, pin) {
  if (!pin || typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin)) {
    return { ok: false, badFormat: true };
  }

  const lock = await prisma.folderLock.findUnique({ where: { path: lockPath } });
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
      where: { path: lockPath },
      data: { pinFailures: failures, pinLockedUntil: lockedUntil },
    });
    if (lockoutMs > 0) {
      return { ok: false, lockedOut: true, retryAfter: Math.ceil(lockoutMs / 1000) };
    }
    return { ok: false };
  }

  if (lock.pinFailures > 0 || lock.pinLockedUntil) {
    await prisma.folderLock.update({
      where: { path: lockPath },
      data: { pinFailures: 0, pinLockedUntil: null },
    });
  }
  return { ok: true };
}

// Gate any file-API route by the lock applying to its target path. Walks up
// the path tree to find an ancestor lock — so a lock on `Documents` gates
// `Documents/Finance/2026` too. Returns null when allowed, a NextResponse
// when the caller must short-circuit. The PIN travels as `X-Folder-Pin` so
// it never lands in URLs or server access logs.
export async function requireFolderUnlock(req, relativePath) {
  const lockedPaths = await getAllLockedPaths();
  if (lockedPaths.length === 0) return null;

  const ancestor = findAncestorLockPath(relativePath, lockedPaths);
  if (!ancestor) return null;

  const pin = req.headers.get('x-folder-pin');
  if (!pin) {
    return NextResponse.json(
      { error: 'pin_required', path: ancestor },
      { status: 423 },
    );
  }

  const result = await verifyFolderPin(ancestor, pin);
  if (result.ok) return null;

  if (result.lockedOut) {
    return NextResponse.json(
      { error: 'pin_locked_out', path: ancestor, retryAfter: result.retryAfter },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }
  return NextResponse.json({ error: 'pin_incorrect', path: ancestor }, { status: 401 });
}
