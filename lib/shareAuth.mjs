/** @format */

import { PrismaClient } from '@prisma/client';

const prisma = globalThis.prisma || new PrismaClient();
globalThis.prisma = prisma;
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
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
