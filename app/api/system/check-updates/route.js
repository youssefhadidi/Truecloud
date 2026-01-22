/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { logger } from '@/lib/logger';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export async function GET(req) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      logger.warn('GET /api/system/check-updates - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Get repo info from environment variable
    const gitHubRepo = process.env.GITHUB_REPO || 'youssefhadidi/Truecloud';

    logger.debug('Checking for updates', { repo: gitHubRepo, currentVersion });

    try {
      // Fetch package.json directly from GitHub main branch (no releases or tags needed)
      const response = await fetch(
        `https://raw.githubusercontent.com/${gitHubRepo}/main/package.json`,
        {
          headers: {
            // Optional: add auth token for higher rate limits
            ...(process.env.GITHUB_TOKEN && { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }),
          },
        }
      );

      if (!response.ok) {
        const errorMsg = response.status === 404 
          ? `Repository not found: ${gitHubRepo}` 
          : `GitHub error: ${response.status}`;

        logger.warn('Failed to fetch package.json from GitHub', { 
          status: response.status,
          repo: gitHubRepo,
        });

        return NextResponse.json({ 
          hasUpdate: false, 
          message: errorMsg,
          currentVersion,
          error: 'github_unavailable',
        }, { status: 200 });
      }

      const remotePackageJson = await response.json();
      const latestVersion = remotePackageJson.version;

      // Simple version comparison
      const hasUpdate = latestVersion !== currentVersion && latestVersion > currentVersion;

      logger.info('Update check complete', { 
        currentVersion, 
        latestVersion, 
        hasUpdate,
      });

      return NextResponse.json({
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: `https://github.com/${gitHubRepo}/commits/main`,
      });
    } catch (error) {
      logger.error('Error fetching GitHub package.json', { error: error.message });
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
