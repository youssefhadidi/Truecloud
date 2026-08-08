/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { logger } from '@/lib/logger';
import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import {
  resolveTorrentServicePath,
  TORRENT_SERVICE_BRANCH,
  TORRENT_SERVICE_REPO_URL,
} from '@/lib/torrentServiceRepo';

// Compare semantic versions properly
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function git(command, cwd, timeout = 10000) {
  return execSync(command, { cwd, encoding: 'utf-8', stdio: 'pipe', timeout });
}

/**
 * Fetches `branch` and reports how the checkout at `cwd` compares to it.
 * Returns `{ error }` (with the version we could still read locally) instead of
 * throwing, so one unreachable repo never blanks out the whole update check.
 */
function inspectRepo(cwd, branch, currentVersion) {
  try {
    git(`git fetch origin ${branch}`, cwd);
  } catch (error) {
    logger.warn('Git fetch failed', { cwd, error: error.message });
    return {
      currentVersion,
      error: 'git_fetch_failed',
      message: 'Failed to fetch updates from git remote',
    };
  }

  let latestVersion;
  try {
    const remotePackageJson = JSON.parse(git(`git show origin/${branch}:package.json`, cwd, 5000));
    latestVersion = remotePackageJson.version;
  } catch (error) {
    logger.error('Failed to read remote package.json', { cwd, error: error.message });
    return {
      currentVersion,
      error: 'git_show_failed',
      message: 'Failed to read remote package.json',
    };
  }

  // How many commits the remote is ahead by. Repos that don't bump their
  // version on every commit rely on this instead of the semver comparison.
  let commitsBehind = null;
  try {
    commitsBehind = parseInt(git(`git rev-list --count HEAD..origin/${branch}`, cwd, 5000).trim(), 10);
    if (Number.isNaN(commitsBehind)) commitsBehind = null;
  } catch (error) {
    logger.warn('Failed to count commits behind remote', { cwd, error: error.message });
  }

  // Identifies the remote HEAD, so the UI can remember a dismissal against a
  // repo whose package.json version never moves.
  let latestCommit = null;
  try {
    latestCommit = git(`git rev-parse --short origin/${branch}`, cwd, 5000).trim() || null;
  } catch (error) {
    logger.warn('Failed to read remote commit', { cwd, error: error.message });
  }

  return { currentVersion, latestVersion, commitsBehind, latestCommit };
}

/**
 * torrent-service ships from a separate repo and keeps its package.json version
 * pinned, so any commit on the remote counts as an update.
 */
function checkTorrentService() {
  const cwd = resolveTorrentServicePath();
  if (!cwd) {
    return {
      available: false,
      hasUpdate: false,
      error: 'not_found',
      message: 'torrent-service checkout not found. Set TORRENT_SERVICE_PATH.',
      repoUrl: TORRENT_SERVICE_REPO_URL,
    };
  }

  let currentVersion = null;
  try {
    currentVersion = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf-8')).version;
  } catch (error) {
    logger.warn('Failed to read torrent-service package.json version', { error: error.message });
  }

  const result = inspectRepo(cwd, TORRENT_SERVICE_BRANCH, currentVersion);
  const hasUpdate = !result.error && (
    result.commitsBehind > 0 ||
    Boolean(result.latestVersion && currentVersion && compareVersions(result.latestVersion, currentVersion) > 0)
  );

  return {
    available: true,
    path: cwd,
    hasUpdate,
    repoUrl: TORRENT_SERVICE_REPO_URL,
    releaseUrl: `${TORRENT_SERVICE_REPO_URL}/commits/${TORRENT_SERVICE_BRANCH}`,
    ...result,
  };
}

export async function GET(req) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    // Read version from package.json file directly (always current)
    let currentVersion = '0.1.0';
    try {
      const packageJsonPath = resolve(process.cwd(), 'package.json');
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      currentVersion = packageJson.version;
    } catch (error) {
      logger.warn('Failed to read package.json version', { error: error.message });
      // Continue with fallback version
    }

    logger.debug('Checking for updates', { currentVersion });

    // Checked independently of the main app so a torrent-service failure never
    // hides an available app update (and vice versa).
    let torrentService;
    try {
      torrentService = checkTorrentService();
    } catch (error) {
      logger.error('Error checking torrent-service for updates', { error: error.message });
      torrentService = {
        available: false,
        hasUpdate: false,
        error: 'check_failed',
        message: error.message,
      };
    }

    try {
      const app = inspectRepo(process.cwd(), 'main', currentVersion);

      if (app.error) {
        return NextResponse.json({
          hasUpdate: false,
          message: app.message,
          currentVersion,
          error: app.error,
          torrentService,
          hasAnyUpdate: torrentService.hasUpdate,
        }, { status: 200 });
      }

      const { latestVersion, commitsBehind } = app;

      logger.debug('Fetched remote version from git', {
        latestVersion,
        currentVersion,
      });

      // Compare versions semantically
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

      logger.info('Update check complete', {
        currentVersion,
        latestVersion,
        hasUpdate,
        torrentServiceHasUpdate: torrentService.hasUpdate,
      });

      return NextResponse.json({
        hasUpdate,
        currentVersion,
        latestVersion,
        commitsBehind,
        releaseUrl: `https://github.com/youssefhadidi/Truecloud/commits/main`,
        torrentService,
        hasAnyUpdate: hasUpdate || torrentService.hasUpdate,
      });
    } catch (error) {
      logger.error('Error checking for updates', { error: error.message });
      return NextResponse.json({
        hasUpdate: false,
        message: `Error checking for updates: ${error.message}`,
        currentVersion,
        error: 'check_failed',
        torrentService,
        hasAnyUpdate: torrentService.hasUpdate,
      }, { status: 200 });
    }
  } catch (error) {
    logger.error('GET /api/system/check-updates - Unexpected error', { error: error.message });
    return NextResponse.json({
      error: 'Failed to check updates',
      message: error.message,
    }, { status: 500 });
  }
}
