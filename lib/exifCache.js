/** @format */

import exifr from 'exifr';
import { extname } from 'node:path';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.tiff', '.tif', '.heic', '.heif', '.png', '.avif']);

// Map<filePath, { mtimeMs: number, date: Date|null }>
const cache = new Map();

export async function getMediaDate(filePath, mtime) {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED.has(ext)) return null;

  const mtimeMs = mtime instanceof Date ? mtime.getTime() : new Date(mtime).getTime();
  const entry = cache.get(filePath);
  if (entry && entry.mtimeMs === mtimeMs) return entry.date;

  try {
    const result = await exifr.parse(filePath, ['DateTimeOriginal']);
    const date = result?.DateTimeOriginal ?? null;
    cache.set(filePath, { mtimeMs, date });
    return date;
  } catch {
    cache.set(filePath, { mtimeMs, date: null });
    return null;
  }
}
