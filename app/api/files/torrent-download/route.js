/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '@/lib/logger';
import {
  addDownload,
  getActiveDownloads,
  getStoppedDownloads,
  getWaitingDownloads,
  pauseDownload,
  resumeDownload,
  removeDownload,
} from '@/lib/aria2Manager';

const TORRENT_FILE_DIR = process.env.TORRENT_FILE_DIR || './torrents';

/**
 * POST /api/files/torrent-download
 * Start a new download (HTTP, torrent, or magnet)
 */
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      logger.warn('POST /api/files/torrent-download - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const torrentFile = formData.get('torrentFile');
    const url = formData.get('url');
    const downloadType = formData.get('downloadType') || 'http';

    if (!torrentFile && !url) {
      return NextResponse.json({ error: 'Please provide either a file or URL' }, { status: 400 });
    }

    let downloadUrl;

    if (torrentFile) {
      // Save torrent file to temp location
      const bytes = await torrentFile.arrayBuffer();
      const torrentPath = join(resolve(process.cwd(), TORRENT_FILE_DIR), torrentFile.name);

      // Ensure torrent directory exists
      const torrentDir = resolve(process.cwd(), TORRENT_FILE_DIR);
      if (!existsSync(torrentDir)) {
        mkdirSync(torrentDir, { recursive: true });
      }

      await writeFile(torrentPath, Buffer.from(bytes));
      logger.info('Torrent file saved', { path: torrentPath, size: bytes.byteLength });

      downloadUrl = torrentPath;
    } else {
      downloadUrl = url;
    }

    // Add download via aria2 manager
    const gid = await addDownload(downloadUrl);

    // Get initial status
    const status = {
      gid,
      name: torrentFile ? torrentFile.name : url,
      status: 'active',
      progress: 0,
      downloadSpeed: '0 B/s',
      downloaded: '0 B',
      totalSize: 'Unknown',
      isTorrent: torrentFile || url.startsWith('magnet:'),
    };

    logger.info('POST /api/files/torrent-download - Download started', {
      gid,
      type: downloadType,
    });

    return NextResponse.json(status);
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('POST /api/files/torrent-download - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * GET /api/files/torrent-download
 * Get list of active and recent downloads with progress
 */
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/torrent-download - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      // Get active downloads
      const activeDownloads = await getActiveDownloads();

      // Get waiting/paused downloads
      const waitingDownloads = await getWaitingDownloads(0, 100);

      // Get recently stopped downloads (completed or failed)
      const stoppedDownloads = await getStoppedDownloads(0, 10);

      // Combine and sort by most recent
      const allDownloads = [...activeDownloads, ...waitingDownloads, ...stoppedDownloads];

      logger.debug('GET /api/files/torrent-download - Success', {
        active: activeDownloads.length,
        waiting: waitingDownloads.length,
        stopped: stoppedDownloads.length,
      });

      return NextResponse.json({ downloads: allDownloads });
    } catch (error) {
      // aria2c daemon not running or not available
      logger.warn('GET /api/files/torrent-download - aria2c unavailable', { error: error.message });
      return NextResponse.json({ downloads: [] });
    }
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('GET /api/files/torrent-download - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * PATCH /api/files/torrent-download
 * Pause/Resume/Remove a download
 */
export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session) {
      logger.warn('PATCH /api/files/torrent-download - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { gid, action } = body;

    if (!gid || !action) {
      return NextResponse.json({ error: 'Missing gid or action' }, { status: 400 });
    }

    switch (action) {
      case 'pause':
        await pauseDownload(gid);
        logger.info('PATCH /api/files/torrent-download - Download paused', { gid });
        return NextResponse.json({ success: true, message: 'Download paused' });

      case 'resume':
        await resumeDownload(gid);
        logger.info('PATCH /api/files/torrent-download - Download resumed', { gid });
        return NextResponse.json({ success: true, message: 'Download resumed' });

      case 'remove':
        await removeDownload(gid);
        logger.info('PATCH /api/files/torrent-download - Download removed', { gid });
        return NextResponse.json({ success: true, message: 'Download removed' });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('PATCH /api/files/torrent-download - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
