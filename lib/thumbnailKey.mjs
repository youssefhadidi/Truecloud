/** @format */

import { createHash } from 'node:crypto';

/**
 * Path-independent thumbnail identity: hash of file name + byte size.
 * Stable across folder rename and move because it ignores the parent path.
 * @param {string} fileName - The file's own name (not the full path)
 * @param {number|bigint} fileSize - The file's size in bytes
 * @returns {string} 64-char hex digest used as the thumbnail filename stem
 */
export function thumbnailKey(fileName, fileSize) {
  return createHash('sha256').update(`${fileName}:${fileSize}`).digest('hex');
}
