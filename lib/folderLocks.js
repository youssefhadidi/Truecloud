/** @format */

import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { createHash } from 'crypto';
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

// ─── Caches ───────────────────────────────────────────────────────────────────
//
// Both of these exist for the same reason: every gated file API call runs
// through requireFolderUnlock, and media streaming turns "every call" into a
// very large number. A feature-length film is hundreds of 4-second HLS segment
// requests, each one previously costing a DB round-trip for the lock list plus
// — inside a locked folder — a full bcrypt compare of the same PIN it just
// verified. bcryptjs is pure JS, so that is ~100 ms of blocking CPU per
// segment, on the same event loop trying to push the video out.
//
// Locks only change through the admin API, which calls invalidateFolderLockCache
// on every mutation. The TTLs are backstops for edits made out-of-band (another
// process, a direct DB write).

let _lockedPathsCache = null;
let _lockedPathsCacheAt = 0;
const LOCKED_PATHS_TTL_MS = 10_000;

// `${lockPath}:${sha256(pin)}` → epoch ms at which the memo expires.
// Successes only: a failure must reach verifyFolderPin so the exponential
// backoff counter still advances, otherwise caching would defeat the lockout.
const _verifiedPins = new Map();
const VERIFIED_PIN_TTL_MS = 5 * 60 * 1000;
const VERIFIED_PIN_MAX_ENTRIES = 500;

/**
 * Drop both caches. Called by every mutating admin folder-lock handler so a
 * changed or removed PIN takes effect immediately rather than at TTL expiry.
 */
export function invalidateFolderLockCache() {
  _lockedPathsCache = null;
  _lockedPathsCacheAt = 0;
  _verifiedPins.clear();
}

// The PIN itself never enters the map — only a digest of it, so a heap dump
// doesn't hand over folder PINs in plaintext.
function verifiedPinKey(lockPath, pin) {
  return `${lockPath}:${createHash('sha256').update(pin).digest('hex')}`;
}

function rememberVerifiedPin(key) {
  if (_verifiedPins.size >= VERIFIED_PIN_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, expiresAt] of _verifiedPins) {
      if (expiresAt <= now) _verifiedPins.delete(k);
    }
    // Still full of live entries — this is a cache, not a ledger, so drop it
    // wholesale rather than growing without bound. Worst case is one extra
    // bcrypt per active viewer.
    if (_verifiedPins.size >= VERIFIED_PIN_MAX_ENTRIES) _verifiedPins.clear();
  }
  _verifiedPins.set(key, Date.now() + VERIFIED_PIN_TTL_MS);
}

/**
 * All locked paths. The returned array is the cached instance — treat it as
 * read-only (every current caller does).
 */
export async function getAllLockedPaths() {
  const now = Date.now();
  if (_lockedPathsCache && now - _lockedPathsCacheAt < LOCKED_PATHS_TTL_MS) {
    return _lockedPathsCache;
  }
  const rows = await prisma.folderLock.findMany({ select: { path: true } });
  _lockedPathsCache = rows.map((r) => r.path);
  _lockedPathsCacheAt = now;
  return _lockedPathsCache;
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

// Extract the PIN this request supplied for `ancestorLockPath`. Tries
// (in order) `X-Folder-Pin` header, `?folderPin=` query param, and the
// per-folder map header `X-Folder-Pins`. Returns null when none match.
//
// Used both by requireFolderUnlock to enforce the gate, and by server-side
// URL rewriters (HLS manifest, GLB buffer rewriting, transcode hlsUrl) that
// need to carry the PIN forward into URLs the browser will fetch on its own.
export function extractIncomingPin(req, ancestorLockPath) {
  let pin = req.headers.get ? req.headers.get('x-folder-pin') : req.headers['x-folder-pin'];
  if (!pin) {
    try {
      pin = new URL(req.url).searchParams.get('folderPin');
    } catch {
      pin = null;
    }
  }
  if (!pin) {
    const raw = req.headers.get ? req.headers.get('x-folder-pins') : req.headers['x-folder-pins'];
    if (raw) {
      try {
        const map = JSON.parse(raw);
        if (map && typeof map === 'object' && typeof map[ancestorLockPath] === 'string') {
          pin = map[ancestorLockPath];
        }
      } catch {
        pin = null;
      }
    }
  }
  return pin || null;
}

// Gate any file-API route by the lock applying to its target path. Walks up
// the path tree to find an ancestor lock — so a lock on `Documents` gates
// `Documents/Finance/2026` too. Returns null when allowed, a NextResponse
// when the caller must short-circuit.
//
// The PIN is read first from the `X-Folder-Pin` header (preferred — stays out
// of URLs and server access logs), then falls back to a `?folderPin=` query
// param. The query fallback exists for browser-native fetches that can't set
// custom headers: anchor-tag downloads, <video src>, <img src>, HLS segments.
export async function requireFolderUnlock(req, relativePath) {
  const lockedPaths = await getAllLockedPaths();
  if (lockedPaths.length === 0) return null;

  const ancestor = findAncestorLockPath(relativePath, lockedPaths);
  if (!ancestor) return null;

  const pin = extractIncomingPin(req, ancestor);
  if (!pin) {
    return NextResponse.json(
      { error: 'pin_required', path: ancestor },
      { status: 423 },
    );
  }

  // Skip bcrypt if this exact PIN was verified for this exact lock recently.
  const memoKey = verifiedPinKey(ancestor, pin);
  const memoExpiresAt = _verifiedPins.get(memoKey);
  if (memoExpiresAt !== undefined) {
    if (memoExpiresAt > Date.now()) return null;
    _verifiedPins.delete(memoKey);
  }

  const result = await verifyFolderPin(ancestor, pin);
  if (result.ok) {
    rememberVerifiedPin(memoKey);
    return null;
  }

  if (result.lockedOut) {
    return NextResponse.json(
      { error: 'pin_locked_out', path: ancestor, retryAfter: result.retryAfter },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }
  return NextResponse.json({ error: 'pin_incorrect', path: ancestor }, { status: 401 });
}
