/** @format */

import fsPromises from 'fs/promises';
import { resolve, dirname } from 'node:path';

const DEFAULT_THUMBNAIL_SIZE = parseInt(process.env.THUMBNAIL_SIZE, 10) || 200;
const DEFAULT_THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY, 10) || 75;

const CONFIG_PATH = resolve(process.cwd(), 'config', 'thumbnail-settings.json');

// In-memory cache for thumbnail config (30 second TTL)
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30_000; // 30 seconds

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
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) {
    return _configCache;
  }

  try {
    const raw = await fsPromises.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _configCache = normalizeThumbnailConfig(parsed);
    _configCacheTime = now;
    return _configCache;
  } catch {
    _configCache = getThumbnailDefaults();
    _configCacheTime = now;
    return _configCache;
  }
}

export async function writeThumbnailConfig(config) {
  const normalized = normalizeThumbnailConfig(config);
  await fsPromises.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  // Invalidate cache
  _configCache = normalized;
  _configCacheTime = Date.now();
  return normalized;
}

export function getThumbnailConfigPath() {
  return CONFIG_PATH;
}
