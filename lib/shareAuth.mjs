/** @format */

import { PrismaClient } from '@prisma/client';

const prisma = globalThis.prisma || new PrismaClient();
globalThis.prisma = prisma;
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { checkShareRateLimit, recordShareFailure, recordShareSuccess, clientIpFromHeaders } from './shareRateLimit.mjs';

const UPLOAD_ROOT = resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');

// Re-export so route handlers get the IP helper from the same module they
// already import verifyShare from.
export { clientIpFromHeaders };

// In-memory cache for verified shares — avoids repeated DB + bcrypt on every request
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const shareCache = new Map();

/**
 * Generate a cryptographically secure, unguessable share token.
 * The token is the sole credential for a public share, so it must be
 * unpredictable (cuid is collision-resistant but NOT unguessable).
 * @returns {string} URL-safe random token (~32 chars, 192 bits of entropy)
 */
export function generateShareToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Invalidate all cached verification results for a token. Must be called
 * whenever a share is revoked, its password changes, or its expiration
 * changes — otherwise a stale cached entry keeps the share accessible (or
 * keeps validating against the old password) for up to CACHE_TTL.
 * @param {string} token - Share token
 */
export function invalidateShareCache(token) {
  if (!token) return;
  const prefix = `${token}:`;
  for (const key of shareCache.keys()) {
    if (key.startsWith(prefix)) shareCache.delete(key);
  }
}

/**
 * Verify a share token and optional password
 * @param {string} token - Share token
 * @param {string|null} password - Optional password
 * @param {string|null} clientId - Client identifier (IP) for brute-force throttling
 * @returns {Promise<object>} { valid, share, error, requiresPassword, rateLimited?, retryAfter? }
 */
export async function verifyShare(token, password = null, clientId = null) {
  // Pages-router query values can be arrays; only a plain string is a password
  if (typeof password !== 'string') password = null;

  // Check cache first — keyed by token + password.
  // A correct (cached) password short-circuits here, so the rate limiter below
  // only ever sees wrong-password attempts.
  const cacheKey = `${token}:${password || ''}`;
  const cached = shareCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Re-check expiration on cached result
    if (cached.result.valid && cached.result.share?.expiresAt && new Date() > cached.result.share.expiresAt) {
      shareCache.delete(cacheKey);
    } else {
      return cached.result;
    }
  }

  // If a password was supplied, reject early when this client/token is locked
  // out — before touching the DB or bcrypt — so a guesser can't keep us busy.
  if (password) {
    const limit = checkShareRateLimit(token, clientId);
    if (limit.limited) {
      return {
        valid: false,
        share: null,
        error: 'Too many failed attempts. Please try again later.',
        requiresPassword: false,
        rateLimited: true,
        retryAfter: limit.retryAfter,
      };
    }
  }

  const share = await prisma.share.findUnique({
    where: { token },
    include: { owner: { select: { id: true, username: true, role: true, hasRootAccess: true } } },
  });

  // A share outside what its owner may access (crafted path, or the owner has
  // since lost root access) is treated as nonexistent.
  if (!share || !isShareInOwnerScope(share)) {
    return { valid: false, share: null, error: 'Share not found', requiresPassword: false };
  }

  // Check expiration
  if (share.expiresAt && new Date() > share.expiresAt) {
    return { valid: false, share: null, error: 'Share has expired', requiresPassword: false };
  }

  // Check password if required
  if (share.passwordHash) {
    if (!password) {
      return { valid: false, share, error: 'Password required', requiresPassword: true };
    }
    const isValid = await bcrypt.compare(password, share.passwordHash);
    if (!isValid) {
      recordShareFailure(token, clientId);
      return { valid: false, share: null, error: 'Invalid password', requiresPassword: false };
    }
    recordShareSuccess(token, clientId);
  }

  const result = { valid: true, share, error: null, requiresPassword: false };

  // Cache successful verifications
  shareCache.set(cacheKey, { result, timestamp: Date.now() });

  return result;
}

/**
 * Split a relative path into segments, rejecting anything that could step
 * outside it. Returns null for non-strings (query/JSON values can be arrays or
 * objects), NUL bytes, and '.' / '..' segments.
 * @param {unknown} value
 * @param {{ allowBackslash?: boolean }} [options]
 * @returns {string[]|null}
 */
function safeSegments(value, { allowBackslash = false } = {}) {
  if (typeof value !== 'string') return null;
  if (value.includes('\0')) return null;
  // Backslash is an ordinary filename character on Linux, but the private-
  // uploads ownership check treats it as a separator — reject it so both
  // sides agree on which top-level entry a path belongs to.
  if (!allowBackslash && value.includes('\\')) return null;
  const segments = value.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..')) return null;
  return segments;
}

/** Segments of the shared item (path + fileName), or null if it is malformed. */
function shareBaseSegments(share) {
  const segments = safeSegments(share.path ? `${share.path}/${share.fileName}` : share.fileName, { allowBackslash: true });
  return segments?.length ? segments : null;
}

function ownerIsRoot(owner) {
  return Boolean(owner?.hasRootAccess || owner?.role === 'admin');
}

/**
 * True when the shared item lies within what its owner can access: anywhere
 * for root users, otherwise their personal folder.
 */
function isShareInOwnerScope(share) {
  const segments = shareBaseSegments(share);
  if (!segments) return false;
  if (!share.owner) return false;
  return ownerIsRoot(share.owner) || segments[0] === `user_${share.ownerId}`;
}

/**
 * Check if a requested path is within the shared path (for directory shares)
 * @param {object} share - The share object
 * @param {string} requestedSubPath - Sub-path within the share (optional)
 * @returns {object} { allowed: boolean, fullPath: string|null, error: string|null }
 */
export function validateSharePath(share, requestedSubPath = '') {
  const baseSegments = shareBaseSegments(share);
  if (!baseSegments) {
    return { allowed: false, fullPath: null, error: 'Invalid path' };
  }

  // Prevent directory traversal (and non-string values smuggled in via JSON
  // bodies or repeated query params)
  const subSegments = safeSegments(requestedSubPath ?? '');
  if (!subSegments) {
    return { allowed: false, fullPath: null, error: 'Invalid path' };
  }

  // For files, subPath must be empty
  if (!share.isDirectory && subSegments.length) {
    return { allowed: false, fullPath: null, error: 'Cannot access subpath of a file share' };
  }

  return { allowed: true, fullPath: [...baseSegments, ...subSegments].join('/'), error: null };
}

/**
 * realpath() of `p`, or of its nearest existing ancestor with the missing
 * tail re-appended (for targets about to be created).
 */
async function realpathOfNearest(p) {
  const tail = [];
  let current = p;
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch (err) {
      const parent = dirname(current);
      if ((err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') || parent === current) throw err;
      tail.push(basename(current));
      current = parent;
    }
  }
}

const isInside = (child, parent) => child === parent || child.startsWith(parent + sep);

/**
 * Filesystem-level scope check for a validateSharePath() fullPath. Resolves
 * symlinks, so a link inside the shared folder can't expose what it points
 * to, and for non-root owners the shared folder itself must resolve inside
 * their personal folder. Call before touching the disk.
 * @param {object} share - share from verifyShare (includes owner)
 * @param {string} fullPath - UPLOAD_DIR-relative path from validateSharePath
 * @returns {Promise<boolean>}
 */
export async function isWithinShare(share, fullPath) {
  const baseSegments = shareBaseSegments(share);
  if (!baseSegments || typeof fullPath !== 'string') return false;

  const root = resolve(UPLOAD_ROOT, ...baseSegments);
  const target = resolve(UPLOAD_ROOT, fullPath);
  if (!isInside(root, UPLOAD_ROOT) || root === UPLOAD_ROOT || !isInside(target, root)) return false;

  try {
    const realRoot = await realpath(root);
    if (!ownerIsRoot(share.owner)) {
      const realHome = await realpath(resolve(UPLOAD_ROOT, `user_${share.ownerId}`));
      if (!isInside(realRoot, realHome)) return false;
    }
    return isInside(await realpathOfNearest(target), realRoot);
  } catch {
    return false;
  }
}

// ─── Private-uploads shares ────────────────────────────────────────────────
// Visitors identify with an (unverified) email stored in a per-share cookie.
// Ownership is tracked only for top-level entries of the shared folder; any
// nested path belongs to the owner of its first segment.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize a visitor email. Returns null when missing or malformed.
 * @param {string} value
 * @returns {string|null}
 */
export function normalizeShareEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Cookie holding the visitor email for one share. */
export function shareEmailCookieName(token) {
  return `tc_se_${token}`;
}

/**
 * Read the visitor email cookie from an App Router request (req.cookies.get)
 * or a Pages Router request (req.cookies object).
 * @returns {string|null} normalized email
 */
export function readShareEmail(req, token) {
  const name = shareEmailCookieName(token);
  let raw = null;
  if (typeof req?.cookies?.get === 'function') {
    raw = req.cookies.get(name)?.value ?? null;
  } else if (req?.cookies) {
    raw = req.cookies[name] ?? null;
  }
  if (raw) {
    try { raw = decodeURIComponent(raw); } catch {}
  }
  return normalizeShareEmail(raw);
}

/** Normalize an in-share path: forward slashes, no leading/trailing slashes. */
export function normalizeInnerPath(innerPath) {
  return String(innerPath || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Recover the in-share path from a validateSharePath() fullPath.
 * @returns {string} '' for the share root
 */
export function shareInnerPath(share, fullPath) {
  const base = shareBaseSegments(share)?.join('/') ?? '';
  if (!fullPath || fullPath === base) return '';
  return fullPath.startsWith(`${base}/`) ? fullPath.slice(base.length + 1) : fullPath;
}

/** True when the in-share path is the shared folder itself. */
export function isShareRoot(innerPath) {
  return normalizeInnerPath(innerPath) === '';
}

/**
 * Gatekeeper for privateUploads shares. For standard shares always allowed.
 * @param {object} share
 * @param {string|null} email - normalized visitor email
 * @param {string} innerPath - path of the item being accessed, relative to the share root
 * @param {{ allowRoot?: boolean }} options - allowRoot: the share root itself is an acceptable target
 * @returns {Promise<{ allowed: boolean, status?: number, error?: string, emailRequired?: boolean }>}
 */
export async function authorizePrivatePath(share, email, innerPath, { allowRoot = false } = {}) {
  if (!share?.privateUploads) return { allowed: true };
  if (!email) return { allowed: false, status: 401, error: 'Email required', emailRequired: true };

  const normalized = normalizeInnerPath(innerPath);
  if (!normalized) {
    return allowRoot ? { allowed: true } : { allowed: false, status: 403, error: 'Not allowed for this share' };
  }

  const topName = normalized.split('/')[0];
  const row = await prisma.shareUpload.findUnique({
    where: { shareId_name: { shareId: share.id, name: topName } },
    select: { email: true },
  });
  // 404 (not 403) so visitors can't probe for other uploaders' items
  if (!row || row.email !== email) return { allowed: false, status: 404, error: 'Not found' };
  return { allowed: true };
}

/**
 * Whether a share may be created for `share.path`/`share.fileName` by
 * `share.owner` ({ role?, hasRootAccess? }): the name is a single segment, the
 * path has no traversal, and the target resolves (symlinks included) inside
 * what the owner may access.
 * @param {{ path: string, fileName: string, ownerId: string, owner: object }} share
 * @returns {Promise<boolean>}
 */
export async function isShareTargetAllowed(share) {
  const nameSegments = safeSegments(share.fileName, { allowBackslash: true });
  if (nameSegments?.length !== 1 || nameSegments[0] !== share.fileName) return false;
  if (!isShareInOwnerScope(share)) return false;
  return isWithinShare(share, shareBaseSegments(share).join('/'));
}

/**
 * Build the JSON error response body for a failed authorizePrivatePath.
 */
export function privateAccessErrorBody(check) {
  return check.emailRequired ? { error: check.error, emailRequired: true } : { error: check.error };
}

/** Set of top-level names owned by an email in a share. */
export async function getOwnedNames(shareId, email) {
  const rows = await prisma.shareUpload.findMany({
    where: { shareId, email },
    select: { name: true },
  });
  return new Set(rows.map((r) => r.name));
}

function withSuffix(name, n) {
  const dot = name.lastIndexOf('.');
  if (dot > 0) return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  return `${name} (${n})`;
}

// A row whose entry is missing from disk is only treated as stale after this
// long — a fresh row may belong to an upload that is about to be renamed in.
const STALE_CLAIM_MS = 60 * 1000;

/**
 * Atomically claim a top-level name for a visitor and record ownership.
 * The (shareId, name) unique index makes concurrent claims safe: only one
 * visitor can win a given name.
 *
 * - A name already owned by this email is reused when `allowOwnedOverwrite`
 *   (upload overwrite semantics) or when it no longer exists on disk.
 * - Untracked entries (e.g. the owner's own files) and other visitors'
 *   entries are never taken; " (n)" suffixes are tried instead, unless
 *   `exact` is set, in which case null is returned.
 * - Stale rows (entry gone from disk) are pruned along the way.
 *
 * @param {object} share
 * @param {string} email
 * @param {string} rootDir - filesystem path of the share root
 * @param {string} desired
 * @param {{ allowOwnedOverwrite?: boolean, exact?: boolean }} [options]
 * @returns {Promise<string|null>} the claimed name, or null when `exact` and unavailable
 */
export async function claimRootName(share, email, rootDir, desired, { allowOwnedOverwrite = true, exact = false } = {}) {
  const attempts = exact ? 1 : 10000;
  for (let n = 0; n < attempts; n++) {
    const candidate = n === 0 ? desired : withSuffix(desired, n);
    const onDisk = existsSync(join(rootDir, candidate));
    const row = await prisma.shareUpload.findUnique({
      where: { shareId_name: { shareId: share.id, name: candidate } },
      select: { id: true, email: true, createdAt: true },
    });

    if (row) {
      if (row.email === email) {
        if (allowOwnedOverwrite || !onDisk) return candidate;
        continue;
      }
      if (onDisk || Date.now() - new Date(row.createdAt).getTime() < STALE_CLAIM_MS) continue;
      await prisma.shareUpload.deleteMany({ where: { id: row.id } });
    } else if (onDisk) {
      continue;
    }

    try {
      await prisma.shareUpload.create({ data: { shareId: share.id, name: candidate, email } });
      return candidate;
    } catch (e) {
      if (e?.code === 'P2002') {
        // Lost a concurrent claim for this name — try the next suffix
        if (exact) return null;
        continue;
      }
      throw e;
    }
  }
  return exact ? null : `${Date.now()}_${desired}`;
}

/**
 * Uploader emails for the entries of a directory (authenticated file browser).
 * - Directory is the root of a private-uploads share → per-entry emails.
 * - Directory is inside an uploader's top-level folder → every entry belongs
 *   to that uploader.
 * @param {string} relativePath - directory relative to UPLOAD_DIR
 * @returns {Promise<(name: string) => string|null>} lookup by entry name
 */
export async function getUploaderLookup(relativePath) {
  const dir = normalizeInnerPath(relativePath);
  const shares = await prisma.share.findMany({
    where: { privateUploads: true, isDirectory: true },
    select: { id: true, path: true, fileName: true },
  });

  const byName = new Map();
  let wholeDir = null;

  for (const s of shares) {
    const base = normalizeInnerPath(s.path ? `${s.path}/${s.fileName}` : s.fileName);
    if (dir === base) {
      const rows = await prisma.shareUpload.findMany({
        where: { shareId: s.id },
        select: { name: true, email: true },
      });
      for (const row of rows) if (!byName.has(row.name)) byName.set(row.name, row.email);
    } else if (!wholeDir && dir.startsWith(`${base}/`)) {
      const topName = dir.slice(base.length + 1).split('/')[0];
      const row = await prisma.shareUpload.findUnique({
        where: { shareId_name: { shareId: s.id, name: topName } },
        select: { email: true },
      });
      if (row) wholeDir = row.email;
    }
  }

  return (name) => byName.get(name) || wholeDir;
}

/** Drop top-level ownership rows. */
export async function removeRootEntries(shareId, names) {
  if (!names.length) return;
  await prisma.shareUpload.deleteMany({ where: { shareId, name: { in: names } } });
}

/**
 * Increment access count for a share
 * @param {string} shareId - Share ID
 */
export async function incrementShareAccess(shareId) {
  await prisma.share.update({
    where: { id: shareId },
    data: { accessCount: { increment: 1 } },
  });
}

/**
 * Get share by path and filename (for checking if a file is shared)
 * @param {string} path - File path
 * @param {string} fileName - File name
 * @param {string} ownerId - Owner ID
 * @returns {Promise<object|null>} Share object or null
 */
export async function getShareByPath(path, fileName, ownerId) {
  return prisma.share.findFirst({
    where: {
      path,
      fileName,
      ownerId,
    },
  });
}

/**
 * Get all shares for a user
 * @param {string} ownerId - Owner ID
 * @returns {Promise<Array>} Array of shares
 */
export async function getUserShares(ownerId) {
  return prisma.share.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get shared paths for a user (for displaying share indicators)
 * @param {string} ownerId - Owner ID
 * @returns {Promise<Set<string>>} Set of "path/fileName" strings
 */
export async function getSharedPaths(ownerId) {
  const shares = await prisma.share.findMany({
    where: { ownerId },
    select: { path: true, fileName: true },
  });

  return new Set(shares.map((s) => `${s.path}/${s.fileName}`.replace(/\/+/g, '/')));
}
