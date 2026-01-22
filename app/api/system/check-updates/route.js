/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { logger } from '@/lib/logger';

export async function GET(req) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      logger.warn('GET /api/system/check-updates - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get repo info from environment variable
    const gitHubRepo = process.env.GITHUB_REPO || 'youssefhadidi/Truecloud';
    const currentVersion = process.env.npm_package_version || '0.1.0';

    logger.debug('Checking for updates', { repo: gitHubRepo, currentVersion });

    try {
      // Fetch latest release from GitHub API
      const response = await fetch(`https://api.github.com/repos/${gitHubRepo}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          // Optional: add auth token for higher rate limits
          ...(process.env.GITHUB_TOKEN && { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }),
        },
      });

      if (!response.ok) {
        logger.warn('Failed to fetch latest release from GitHub', { status: response.status });
        return NextResponse.json({ 
          hasUpdate: false, 
          message: 'Unable to check for updates',
          currentVersion,
        }, { status: 200 });
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
      
      // Simple version comparison (string comparison works for semantic versioning in most cases)
      const hasUpdate = latestVersion !== currentVersion && latestVersion > currentVersion;

      logger.info('Update check complete', { 
        currentVersion, 
        latestVersion, 
        hasUpdate,
        releaseUrl: release.html_url,
      });

      return NextResponse.json({
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url,
        releaseNotes: release.body,
        publishedAt: release.published_at,
      });
    } catch (error) {
      logger.error('Error fetching GitHub release info', { error: error.message });
      return NextResponse.json({ 
        hasUpdate: false, 
        message: 'Error checking for updates',
        currentVersion,
      }, { status: 200 });
    }
  } catch (error) {
    logger.error('GET /api/system/check-updates - Unexpected error', { error: error.message });
    return NextResponse.json({ error: 'Failed to check updates' }, { status: 500 });
  }
}
