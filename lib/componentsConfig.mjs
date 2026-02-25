/** @format */

import fsPromises from 'fs/promises';
import { resolve, dirname } from 'node:path';

const CONFIG_PATH = resolve(process.cwd(), 'config', 'components.json');

const DEFAULTS = {
  zfs: true,
  smb: true,
  transcoding: false,
  minecraft: false,
};

// In-memory cache (30 second TTL)
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30_000;

export async function readComponentsConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) {
    return _configCache;
  }

  try {
    const raw = await fsPromises.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _configCache = { ...DEFAULTS, ...parsed };
    _configCacheTime = now;
    return _configCache;
  } catch {
    _configCache = { ...DEFAULTS };
    _configCacheTime = now;
    return _configCache;
  }
}

export async function writeComponentsConfig(config) {
  const normalized = {
    zfs: Boolean(config?.zfs ?? DEFAULTS.zfs),
    smb: Boolean(config?.smb ?? DEFAULTS.smb),
    transcoding: Boolean(config?.transcoding ?? DEFAULTS.transcoding),
    minecraft: Boolean(config?.minecraft ?? DEFAULTS.minecraft),
  };
  await fsPromises.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  _configCache = normalized;
  _configCacheTime = Date.now();
  return normalized;
}
