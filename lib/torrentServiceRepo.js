/** @format */

/**
 * torrent-service lives in its own git repo (deployed alongside the main app)
 * because WebTorrent's native addon can't load under Bun — see TORRENT.md.
 * Since it's a separate checkout, it needs its own update check and its own
 * update run; this module holds everything both of those need to know about it.
 */

import { existsSync } from 'fs';
import { resolve, join, basename } from 'path';

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
 * bun installs torrent-service's dependencies, matching the main app.
 *
 * Only the *install* is bun's — the service itself must always be launched with
 * `node index.mjs`, since Bun's ESM loader is what breaks node-datachannel in
 * the first place (see TORRENT.md).
 *
 * TORRENT_SERVICE_PM overrides it, which also covers the case where bun isn't
 * on the service's PATH: set it to an absolute path like /root/.bun/bin/bun.
 */
export function resolvePackageManager() {
  return process.env.TORRENT_SERVICE_PM || 'bun';
}

/**
 * Args that re-run node-datachannel's native build. bun has no `rebuild`
 * command: `bun pm trust` is the equivalent, running lifecycle scripts for
 * trusted packages — the same call the main app's own update makes.
 */
export function nativeRebuildArgs(pm) {
  return basename(pm) === 'bun' ? ['pm', 'trust', '--all'] : ['rebuild', 'node-datachannel'];
}
