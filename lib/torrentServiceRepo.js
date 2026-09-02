/** @format */

/**
 * torrent-service lives in its own git repo (deployed alongside the main app)
 * because WebTorrent's native addon can't load under Bun — see TORRENT.md.
 * Since it's a separate checkout, it needs its own update check and its own
 * update run; this module holds everything both of those need to know about it.
 */

import { existsSync, readFileSync } from 'fs';
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

/** The native addon the rebuild exists for. */
const NATIVE_ADDON = 'node-datachannel';

// Package names are passed to a `shell: true` spawn, so only accept the
// characters an npm name can legally contain.
const SAFE_PACKAGE_NAME = /^@?[a-z0-9._-]+(\/[a-z0-9._-]+)?$/i;

/**
 * The packages `bun pm trust` should run install scripts for.
 *
 * Prefers the checkout's own `trustedDependencies`, since that list is what the
 * torrent-service repo maintains as "needs its lifecycle scripts". Falls back
 * to the addon we know must be built when the list is missing or unreadable.
 */
function trustedDependenciesFor(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const names = (pkg.trustedDependencies || []).filter(
      (name) => typeof name === 'string' && SAFE_PACKAGE_NAME.test(name),
    );
    if (names.length) return names;
  } catch {
    // No readable package.json in the checkout — fall through.
  }
  return [NATIVE_ADDON];
}

/**
 * Args that re-run node-datachannel's native build. bun has no `rebuild`
 * command: `bun pm trust` is the equivalent, running lifecycle scripts for
 * trusted packages.
 *
 * Deliberately NOT `bun pm trust --all`. `--all` runs lifecycle scripts for
 * every dependency that declares one, and WebTorrent pulls in `ip-set`, whose
 * preinstall is an `only-allow pnpm` guard that exits 1 under any other package
 * manager. That aborts the whole step before node-datachannel is ever reached,
 * leaving the service with an unbuilt addon.
 */
export function nativeRebuildArgs(pm, cwd) {
  if (basename(pm) !== 'bun') return ['rebuild', NATIVE_ADDON];
  return ['pm', 'trust', ...trustedDependenciesFor(cwd)];
}
