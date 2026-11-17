/** @format */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Where the optimized variant of an image is cached.
 *
 * The two optimize-image routes, the upload hook and the cache worker all use
 * this one definition, so a variant any of them made is found by the others.
 *
 * Keyed on the file's name, size and mtime — not its folder — so moving a file
 * or renaming its folder keeps its cached variants (a move preserves mtime),
 * the same reason thumbnails key on name+size (lib/thumbnailKey.mjs). Size and
 * mtime also mean a replaced file gets a new entry. Files are sharded by the
 * first two hex digits so no single directory grows unbounded.
 *
 * @param {string} optiCacheDir - absolute opti-cache root
 * @param {string} fileName - the image's base name
 * @param {{ size: number, mtimeMs: number }} st - the image's stat
 * @param {{ quality: number, width: number, height: number, format: string }} variant
 * @returns {string}
 */
export function optiCachePath(optiCacheDir, fileName, st, { quality, width, height, format }) {
  const key = createHash('md5')
    .update(`${fileName}|${st.size}|${st.mtimeMs}|${quality}|${width}|${height}|${format}`)
    .digest('hex');
  return join(optiCacheDir, key.slice(0, 2), `${key}.${format}`);
}
