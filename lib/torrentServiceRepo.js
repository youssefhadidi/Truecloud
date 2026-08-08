/** @format */

/**
 * torrent-service lives in its own git repo (deployed alongside the main app)
 * because WebTorrent's native addon can't load under Bun — see TORRENT.md.
 * Since it's a separate checkout, it needs its own update check and its own
 * update run; this module holds everything both of those need to know about it.
 */

import { existsSync } from 'fs';
import { resolve, join } from 'path';

export const TORRENT_SERVICE_NAME = 'torrent-service';
export const TORRENT_SERVICE_REPO_URL = 'https://github.com/youssefhadidi/torrent-service';
export const TORRENT_SERVICE_BRANCH = 'main';

/**
 * Where the checkout lives. TORRENT_SERVICE_PATH wins; otherwise assume it sits
 * next to the main app (the layout both the docs and the deploy use).
 */
export function resolveTorrentServicePath() {
  const cwd = process.cwd();
  const candidates = [
    process.env.TORRENT_SERVICE_PATH && resolve(process.env.TORRENT_SERVICE_PATH),
    resolve(cwd, '..', TORRENT_SERVICE_NAME),
    resolve(cwd, TORRENT_SERVICE_NAME),
  ].filter(Boolean);

  for (const path of candidates) {
    if (existsSync(join(path, '.git'))) return path;
  }
  return null;
}

/**
 * torrent-service runs on Node, not Bun, so it has its own package manager.
 * Switching between them rewrites node_modules — and node-datachannel's
 * tooling assumes npm's hoisted layout — so npm wins ties and is the default.
 * pnpm is only used when it's unambiguously the one in use.
 * TORRENT_SERVICE_PM overrides when a deploy needs to pin it.
 */
export function detectPackageManager(path) {
  const override = process.env.TORRENT_SERVICE_PM;
  if (override) return override;

  if (existsSync(join(path, 'package-lock.json'))) return 'npm';
  if (existsSync(join(path, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}
