/** @format */

import exifr from 'exifr';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { logger } from './logger.js';

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
    const buffer = await readFile(filePath);
    const result = await exifr.parse(buffer, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']);
    const date = result?.DateTimeOriginal ?? result?.DateTimeDigitized ?? result?.DateTime ?? null;
    cache.set(filePath, { mtimeMs, date });
    return date;
  } catch (err) {
    logger.warn(`exifr failed for ${filePath}`, err);
    cache.set(filePath, { mtimeMs, date: null });
    return null;
  }
}
