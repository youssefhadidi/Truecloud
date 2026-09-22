/** @format */

import { PrismaClient } from '@prisma/client';

const prisma = globalThis.prisma || new PrismaClient();
globalThis.prisma = prisma;
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { existsSync } from 'fs';
import { join } from 'node:path';
import { checkShareRateLimit, recordShareFailure, recordShareSuccess, clientIpFromHeaders } from './shareRateLimit.mjs';

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
    include: { owner: { select: { id: true, username: true } } },
  });

  if (!share) {
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
 * Check if a requested path is within the shared path (for directory shares)
 * @param {object} share - The share object
 * @param {string} requestedSubPath - Sub-path within the share (optional)
 * @returns {object} { allowed: boolean, fullPath: string|null, error: string|null }
 */
export function validateSharePath(share, requestedSubPath = '') {
  // Build base path including the shared item (path + fileName)
  const basePath = share.path ? `${share.path}/${share.fileName}` : share.fileName;

  // Prevent directory traversal
  if (requestedSubPath.includes('..')) {
    return { allowed: false, fullPath: null, error: 'Invalid path' };
  }

  // For files, subPath must be empty
  if (!share.isDirectory && requestedSubPath) {
    return { allowed: false, fullPath: null, error: 'Cannot access subpath of a file share' };
  }

  // Build full path
  const fullPath = requestedSubPath ? `${basePath}/${requestedSubPath}`.replace(/\/+/g, '/') : basePath;

  return { allowed: true, fullPath, error: null };
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
  const base = (share.path ? `${share.path}/${share.fileName}` : share.fileName).replace(/\/+/g, '/');
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
