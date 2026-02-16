/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { logger } from '@/lib/logger';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { execSync } from 'child_process';

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

    try {
      // Fetch latest from remote using git
      try {
        execSync('git fetch origin main', {
          cwd: process.cwd(),
          stdio: 'pipe',
          timeout: 10000,
        });
        logger.debug('Git fetch completed');
      } catch (error) {
        logger.warn('Git fetch failed', { error: error.message });
        return NextResponse.json({ 
          hasUpdate: false, 
          message: 'Failed to fetch updates from git remote',
          currentVersion,
          error: 'git_fetch_failed',
        }, { status: 200 });
      }

      // Get remote package.json using git show
      let remotePackageJsonText;
      try {
        remotePackageJsonText = execSync('git show origin/main:package.json', {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 5000,
        });
      } catch (error) {
        logger.error('Failed to read remote package.json', { error: error.message });
        return NextResponse.json({ 
          hasUpdate: false, 
          message: 'Failed to read remote package.json',
          currentVersion,
          error: 'git_show_failed',
        }, { status: 200 });
      }

      const remotePackageJson = JSON.parse(remotePackageJsonText);
      const latestVersion = remotePackageJson.version;

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
      });

      return NextResponse.json({
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: `https://github.com/youssefhadidi/Truecloud/commits/main`,
      });
    } catch (error) {
      logger.error('Error checking for updates', { error: error.message });
      return NextResponse.json({ 
        hasUpdate: false, 
        message: `Error checking for updates: ${error.message}`,
        currentVersion,
        error: 'check_failed',
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
