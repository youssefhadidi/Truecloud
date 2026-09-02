/** @format */

import { resolve, relative, join, sep } from 'node:path';

/**
 * Guards the generated-cache directories when they are configured to live
 * *inside* UPLOAD_DIR (e.g. UPLOAD_DIR=/mnt/data with CACHE_DIR=/mnt/data/cache).
 *
 * In that layout every thumbnail, HLS segment and HEIC conversion sits in the
 * same tree the file browser walks, so without a guard the cache shows up as
 * user content — listable, renamable, deletable — and the index worker walks
 * millions of segment files.
 *
 * When cache storage is configured outside the upload tree (the usual setup)
 * PROTECTED_DIRS is empty and every export here is a no-op, so wiring these
 * checks in costs nothing for deployments that don't need them.
 */

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR);

// Every env var pointing at a generated-cache directory, paired with the
// fallbacks the consuming modules apply when it is unset. Both the configured
// value and the fallbacks are protected: which one is live depends on the
// deployment, and guarding an unused path costs nothing because anything
// outside UPLOAD_DIR is dropped below.
const CACHE_DIR_CANDIDATES = [
  // lib/fileUtils.js defaults to ./thumbnails, lib/thumbnailUtils.js to ./.thumbnails
  [process.env.THUMBNAIL_DIR, './thumbnails', './.thumbnails'],
  [process.env.OPTI_CACHE_DIR, './opti-cache'],
  [process.env.STREAM_CACHE_DIR, './stream-cache'],
  [process.env.CACHE_DIR, './.cache'],
  [process.env.HEIC_DIR],
  [process.env.HEIC_CACHE_DIR],
  [process.env.TORRENT_FILE_DIR, './torrents'],
];

/**
 * Directory names that have never been user content, skipped by every tree
 * walker. Previously duplicated verbatim in fileWatcher, storageScanner and
 * buildFileIndexWorker; they now share this one.
 */
export const IGNORED_DIR_NAMES = [
  '.thumbnails',
  'opti-cache',
  'stream-cache',
  '.cache',
  'node_modules',
  'iocage',
  'clientmqueue',
];

function isInsideUploadDir(absolutePath) {
  return absolutePath !== RESOLVED_UPLOAD_DIR && absolutePath.startsWith(RESOLVED_UPLOAD_DIR + sep);
}

// Cache directories that physically live inside UPLOAD_DIR.
const PROTECTED_DIRS = [
  ...new Set(
    CACHE_DIR_CANDIDATES.flat()
      .filter(Boolean)
      .map((configured) => resolve(process.cwd(), configured)),
  ),
].filter(isInsideUploadDir);

/** UPLOAD_DIR-relative POSIX paths of the protected dirs. Empty when none apply. */
export const PROTECTED_CACHE_PATHS = PROTECTED_DIRS.map((absolutePath) =>
  relative(RESOLVED_UPLOAD_DIR, absolutePath).replace(/\\/g, '/'),
);

/** True when any cache directory is configured inside UPLOAD_DIR. */
export function hasProtectedCachePaths() {
  return PROTECTED_DIRS.length > 0;
}

/**
 * True when the path IS a protected cache directory or sits inside one.
 * Use for reads, listings and creates — the path itself is off-limits.
 * @param {string} absolutePath
 */
export function isCachePath(absolutePath) {
  if (PROTECTED_DIRS.length === 0) return false;
  const target = resolve(absolutePath);
  return PROTECTED_DIRS.some((dir) => target === dir || target.startsWith(dir + sep));
}

/**
 * True when the path is an ancestor *holding* a protected cache directory.
 * Deleting or renaming such a folder would take the cache with it, so
 * destructive operations check this on top of isCachePath.
 * @param {string} absolutePath
 */
export function containsCachePath(absolutePath) {
  if (PROTECTED_DIRS.length === 0) return false;
  const target = resolve(absolutePath);
  return PROTECTED_DIRS.some((dir) => dir.startsWith(target + sep));
}

/**
 * Guard for destructive operations (delete, rename, move source): rejects both
 * the cache directories themselves and any folder containing one.
 * @param {string} absolutePath
 */
export function isProtectedFromWrite(absolutePath) {
  return isCachePath(absolutePath) || containsCachePath(absolutePath);
}

/**
 * isCachePath for a path relative to UPLOAD_DIR, as the API routes carry them.
 * @param {string} relativePath
 */
export function isCacheRelativePath(relativePath) {
  if (PROTECTED_DIRS.length === 0) return false;
  return isCachePath(join(RESOLVED_UPLOAD_DIR, relativePath || ''));
}

/**
 * Listing filter: true when `name` inside `parentRelativePath` is a cache dir.
 * @param {string} parentRelativePath - directory being listed, relative to UPLOAD_DIR
 * @param {string} name - entry name
 */
export function isCacheEntry(parentRelativePath, name) {
  if (PROTECTED_DIRS.length === 0) return false;
  return isCachePath(join(RESOLVED_UPLOAD_DIR, parentRelativePath || '', name));
}

/**
 * Combined skip test for the tree walkers (watcher, scanner, index worker):
 * the legacy ignored names plus any cache directory inside UPLOAD_DIR.
 * @param {string} name - entry name
 * @param {string} absolutePath - full path to the entry
 */
export function shouldSkipScanEntry(name, absolutePath) {
  if (IGNORED_DIR_NAMES.includes(name)) return true;
  return isCachePath(absolutePath);
}

/** Standard rejection payload for API routes. */
export const CACHE_PATH_ERROR = 'This location is reserved for system cache';
