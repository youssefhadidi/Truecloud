/** @format */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Where the optimized variant of an image is cached.
 *
 * The two optimize-image routes and the cache worker each built this key their
 * own way (different inputs, relative vs absolute paths), so none of them ever
 * found a file another had written. This is the one definition.
 *
 * Size and mtime are in the key, so a replaced file gets a new entry rather
 * than being compared against the cache file's mtime.
 *
 * @param {string} optiCacheDir - absolute opti-cache root
 * @param {string} relativeDir - the image's folder, relative to UPLOAD_DIR
 * @param {string} absolutePath - the image's resolved absolute path
 * @param {{ size: number, mtimeMs: number }} st - the image's stat
 * @param {{ quality: number, width: number, height: number, format: string }} variant
 * @returns {string}
 */
export function optiCachePath(optiCacheDir, relativeDir, absolutePath, st, { quality, width, height, format }) {
  const key = createHash('md5')
    .update(`${absolutePath}|${st.size}|${st.mtimeMs}|${quality}|${width}|${height}|${format}`)
    .digest('hex');
  return join(optiCacheDir, relativeDir || '', `${key}.${format}`);
}
