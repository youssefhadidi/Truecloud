/** @format */

import fsPromises from 'fs/promises';
import { resolve, dirname } from 'node:path';

const DEFAULT_THUMBNAIL_SIZE = parseInt(process.env.THUMBNAIL_SIZE, 10) || 200;
const DEFAULT_THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY, 10) || 75;

const CONFIG_PATH = resolve(process.cwd(), 'config', 'thumbnail-settings.json');

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function getThumbnailDefaults() {
  return {
    size: DEFAULT_THUMBNAIL_SIZE,
    quality: DEFAULT_THUMBNAIL_QUALITY,
  };
}

export function normalizeThumbnailConfig(input) {
  const defaults = getThumbnailDefaults();
  return {
    size: clampInt(input?.size, 64, 1024, defaults.size),
    quality: clampInt(input?.quality, 30, 100, defaults.quality),
  };
}

export async function readThumbnailConfig() {
  try {
    const raw = await fsPromises.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeThumbnailConfig(parsed);
  } catch {
    return getThumbnailDefaults();
  }
}

export async function writeThumbnailConfig(config) {
  const normalized = normalizeThumbnailConfig(config);
  await fsPromises.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

export function getThumbnailConfigPath() {
  return CONFIG_PATH;
}
