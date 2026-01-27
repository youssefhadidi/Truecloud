/** @format */

import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

/**
 * Verify a share token and optional password
 * @param {string} token - Share token
 * @param {string|null} password - Optional password
 * @returns {Promise<object>} { valid: boolean, share: Share|null, error: string|null, requiresPassword: boolean }
 */
export async function verifyShare(token, password = null) {
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
      return { valid: false, share: null, error: 'Invalid password', requiresPassword: false };
    }
  }

  return { valid: true, share, error: null, requiresPassword: false };
}

/**
 * Check if a requested path is within the shared path (for directory shares)
 * @param {object} share - The share object
 * @param {string} requestedSubPath - Sub-path within the share (optional)
 * @returns {object} { allowed: boolean, fullPath: string|null, error: string|null }
 */
export function validateSharePath(share, requestedSubPath = '') {
  const basePath = share.path;

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
