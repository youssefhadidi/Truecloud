/** @format */

import fsPromises from 'fs/promises';
import { resolve, dirname } from 'node:path';

const CONFIG_PATH = resolve(process.cwd(), 'config', 'transcoding-settings.json');

// Valid height presets — null means no scaling (original resolution)
const VALID_HEIGHTS = new Set([null, 480, 720, 1080, 1440, 2160]);

const DEFAULTS = {
  maxHeight: null, // No resolution cap by default
};

// In-memory cache (30 second TTL)
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30_000;

export function normalizeTranscodingConfig(input) {
  const raw = input?.maxHeight;
  const parsed = raw === null || raw === undefined ? null : parseInt(raw, 10);
  const maxHeight = VALID_HEIGHTS.has(parsed) ? parsed : DEFAULTS.maxHeight;
  return { maxHeight };
}

export async function readTranscodingConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) {
    return _configCache;
  }

  try {
    const raw = await fsPromises.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _configCache = normalizeTranscodingConfig(parsed);
    _configCacheTime = now;
    return _configCache;
  } catch {
    _configCache = { ...DEFAULTS };
    _configCacheTime = now;
    return _configCache;
  }
}

export async function writeTranscodingConfig(config) {
  const normalized = normalizeTranscodingConfig(config);
  await fsPromises.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  _configCache = normalized;
  _configCacheTime = Date.now();
  return normalized;
}

export function getTranscodingConfigPath() {
  return CONFIG_PATH;
}
