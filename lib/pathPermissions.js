/** @format */

import { prisma } from './prisma';

// Nearly every file route checks root access, so a folder of thumbnails would
// otherwise cost one identical query per image. Admin edits clear the entry via
// clearRootAccessCache; the TTL bounds staleness for out-of-band DB edits.
// Entries hold the query promise so concurrent misses share one query.
// globalThis because this module is loaded from both app- and pages-router
// bundles, and a clear must reach both.
//
// Maps userId -> { promise: Promise<boolean>, timestamp }
const rootAccessCache = (globalThis.__rootAccessCache ??= new Map());
const ROOT_ACCESS_TTL = 30_000; // 30 seconds

/**
 * Check if user has root access to the file system
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if user has root access
 */
export function hasRootAccess(userId) {
  const now = Date.now();
  const cached = rootAccessCache.get(userId);
  if (cached && now - cached.timestamp < ROOT_ACCESS_TTL) return cached.promise;

  const promise = prisma.user
    .findUnique({
      where: { id: userId },
      select: { hasRootAccess: true, role: true },
    })
    .then((user) => Boolean(user?.hasRootAccess || user?.role === 'admin'));
  const entry = { promise, timestamp: now };
  rootAccessCache.set(userId, entry);
  promise.catch(() => {
    if (rootAccessCache.get(userId) === entry) rootAccessCache.delete(userId);
  });
  return promise;
}

/**
 * Drop a user's cached root-access flag. Call after changing their role or
 * hasRootAccess, or deleting them.
 */
export function clearRootAccessCache(userId) {
  rootAccessCache.delete(userId);
}

/**
 * Normalize and validate a path for a user
 * Non-root users' relative paths are automatically prefixed with their personal folder
 * Non-root users requesting root (empty path) are redirected to their personal folder
 * @param {string} relativePath - The requested path
 * @param {string} userId - User ID
 * @param {boolean} isRootUser - Whether user has root access
 * @returns {object} { path: normalized path, redirected: boolean, error: error message if any }
 */
export function normalizePath(relativePath, userId, isRootUser) {
  // Root users can access any path
  if (isRootUser) {
    return {
      path: relativePath,
      redirected: false,
      error: null,
    };
  }

  // Non-root users: handle different path scenarios
  // Empty path -> redirect to personal folder
  if (relativePath === '') {
    return {
      path: `user_${userId}`,
      redirected: true,
      error: null,
    };
  }

  // Path already starts with their user folder -> allow
  if (relativePath.startsWith(`user_${userId}`)) {
    return {
      path: relativePath,
      redirected: false,
      error: null,
    };
  }

  // Path starts with user_ but not theirs (trying to access another user's folder) -> deny
  if (relativePath.startsWith('user_')) {
    return {
      path: null,
      redirected: false,
      error: 'Access denied',
      status: 403,
    };
  }

  // Relative path without user_ prefix -> prepend their personal folder
  return {
    path: `user_${userId}/${relativePath}`,
    redirected: false,
    error: null,
  };
}

/**
 * Check if user can read from a path
 * @param {string} relativePath - The path to check
 * @param {string} userId - User ID
 * @param {boolean} isRootUser - Whether user has root access
 * @returns {object} { allowed: boolean, normalizedPath: string, error: error message if not allowed }
 */
export async function canRead(relativePath, userId, isRootUser) {
  const normalized = normalizePath(relativePath, userId, isRootUser);

  if (normalized.error) {
    return {
      allowed: false,
      normalizedPath: null,
      error: normalized.error,
      status: normalized.status,
    };
  }

  return {
    allowed: true,
    normalizedPath: normalized.path,
    error: null,
  };
}

/**
 * Check if user can write to a path (create, upload, delete, rename)
 * @param {string} relativePath - The path to check
 * @param {string} userId - User ID
 * @param {boolean} isRootUser - Whether user has root access
 * @returns {object} { allowed: boolean, normalizedPath: string, error: error message if not allowed }
 */
export async function canWrite(relativePath, userId, isRootUser) {
  const normalized = normalizePath(relativePath, userId, isRootUser);

  if (normalized.error) {
    return {
      allowed: false,
      normalizedPath: null,
      error: normalized.error,
      status: normalized.status,
    };
  }

  return {
    allowed: true,
    normalizedPath: normalized.path,
    error: null,
  };
}

/**
 * Check access and get normalized path for file operations
 * Handles both read and write operations
 * @param {object} options - Options object
 * @param {string} options.userId - User ID
 * @param {string} options.path - Requested path
 * @param {string} options.operation - Operation type: 'read', 'write'
 * @param {boolean} options.isRootUser - Whether user has root access
 * @returns {object} { allowed: boolean, normalizedPath: string, error: error message, status: HTTP status code }
 */
export function checkPathAccess(options) {
  const { userId, path, operation, isRootUser } = options;

  const normalized = normalizePath(path, userId, isRootUser);

  if (normalized.error) {
    return {
      allowed: false,
      normalizedPath: null,
      error: normalized.error,
      status: normalized.status,
      redirected: false,
    };
  }

  return {
    allowed: true,
    normalizedPath: normalized.path,
    error: null,
    status: 200,
    redirected: normalized.redirected,
  };
}
