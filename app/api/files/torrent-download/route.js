/** @format */

/**
 * Torrent Download API Routes
 *
 * POST: Start a new torrent download (.torrent file upload or magnet link)
 *   - Saves .torrent files to disk, converts to file:// URL for WebTorrent
 *   - Resolves the relative download path to an absolute directory
 *   - Passes both absolute dir and relative path to webTorrentManager
 *   - Broadcasts 'download-added' via WebSocket
 *
 * GET: List all downloads (active and paused)
 *   - Optional ?path= query param filters by relative directory path
 *   - Used by the frontend for initial state fetch on WebSocket connect
 *   - Completed downloads are removed immediately from memory/WebTorrent
 *
 * PATCH: Control a download (pause/resume/remove)
 *   - Delegates to webTorrentManager functions
 *   - Pause/resume broadcasts are handled by the manager (not here)
 *   - Remove broadcast IS handled here (manager doesn't broadcast for remove)
 */

import { NextResponse } from 'next/server';
import { requireAuth, requireAuthNoActivity } from '@/lib/authCheck';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '@/lib/logger';
import {
  addDownload,
  getActiveDownloads,
  getWaitingDownloads,
  getCompletedDownloads,
  clearCompletedDownloads,
  pauseDownload,
  resumeDownload,
  removeDownload,
} from '@/lib/torrentClient';
import { requireFolderUnlock } from '@/lib/folderLocks';

const TORRENT_FILE_DIR = process.env.TORRENT_FILE_DIR || './torrents';
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR) // absolute path from env
  : resolve(process.cwd(), './uploads'); // fallback relative to cwd

/**
 * POST /api/files/torrent-download
 * Start a new download (HTTP, torrent, or magnet)
 */
export async function POST(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    const formData = await req.formData();
    const torrentFile = formData.get('torrentFile');
    const url = formData.get('url');
    const downloadPath = formData.get('path') || '';

    // Only accept torrent files or magnet links
    if (!torrentFile && !url) {
      return NextResponse.json({ error: 'Please provide a torrent file or magnet link' }, { status: 400 });
    }

    if (url && !url.startsWith('magnet:')) {
      return NextResponse.json({ error: 'Only magnet links are supported (no HTTP downloads)' }, { status: 400 });
    }

    const locked = await requireFolderUnlock(req, downloadPath || '');
    if (locked) return locked;

    // Build absolute download directory - use UPLOAD_DIR from env if available
    let downloadDir = UPLOAD_DIR; // default: root of UPLOAD_DIR
    if (downloadPath) {
      downloadDir = resolve(UPLOAD_DIR, downloadPath.replace(/^\/+/, ''));
    }

    // Security: prevent directory traversal via downloadPath
    const resolvedDownloadDir = resolve(downloadDir);
    if (!resolvedDownloadDir.startsWith(resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: 'Invalid download path' }, { status: 400 });
    }

    // Ensure directory exists
    if (!existsSync(downloadDir)) {
      mkdirSync(downloadDir, { recursive: true });
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

      // Convert to file:// URL for WebTorrent (use absolute path)
      downloadUrl = 'file://' + torrentPath;
    } else {
      // url is magnet link
      downloadUrl = url;
    }

    // Add download via WebTorrent manager with specified directory
    // dir = absolute path for WebTorrent file I/O
    // relativePath = browser-relative path for frontend display/filtering
    const gid = await addDownload(downloadUrl, { dir: downloadDir, relativePath: downloadPath });

    // Get initial status
    const status = {
      gid,
      name: torrentFile ? torrentFile.name : url,
      path: downloadPath,
      status: 'active',
      progress: 0,
      downloadSpeed: '0 B/s',
      downloaded: '0 B',
      totalSize: 'Unknown',
      isTorrent: true,
    };

    logger.info('POST /api/files/torrent-download - Download started', {
      gid,
      path: downloadPath,
    });

    // Broadcast to WebSocket clients
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-added',
        payload: status,
      });
    }

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
 * Query params:
 *   - path: (optional) Filter downloads by directory path
 */
export async function GET(req) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    try {
      // Get optional path filter from query params
      const { searchParams } = new URL(req.url);
      const filterPath = searchParams.get('path');

      logger.debug('GET /api/files/torrent-download', { filterPath });

      // Fetch active, paused and completed downloads in parallel
      const [activeDownloads, waitingDownloads, completedDownloads] = await Promise.all([
        getActiveDownloads(filterPath),
        getWaitingDownloads(0, 100, filterPath),
        getCompletedDownloads(filterPath),
      ]);

      // Completed downloads are history: they are returned here for the downloads
      // page, and left out of GET /api/files so the browser shows the real file.
      const allDownloads = [...activeDownloads, ...waitingDownloads, ...completedDownloads];

      logger.debug('GET /api/files/torrent-download - Success', {
        active: activeDownloads.length,
        waiting: waitingDownloads.length,
        completed: completedDownloads.length,
        filterPath,
      });

      // Broadcast current downloads to all connected WebSocket clients
      if (global.broadcastTorrentDownloadUpdate && allDownloads.length > 0) {
        global.broadcastTorrentDownloadUpdate({
          type: 'downloads-status',
          payload: {
            downloads: allDownloads,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return NextResponse.json({ downloads: allDownloads });
    } catch (error) {
      // WebTorrent client error or unavailable
      logger.warn('GET /api/files/torrent-download - Error fetching downloads', { error: error.message });
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
    const { session, error } = await requireAuth();
    if (error) return error;

    const body = await req.json();
    const { gid, action } = body;

    // The only action that isn't about one download.
    if (action === 'clear-completed') {
      const cleared = await clearCompletedDownloads();
      logger.info('PATCH /api/files/torrent-download - Completed history cleared', { cleared });
      // The service broadcasts a download-removed per entry, so clients update themselves.
      return NextResponse.json({ success: true, cleared });
    }

    if (!gid || !action) {
      return NextResponse.json({ error: 'Missing gid or action' }, { status: 400 });
    }

    switch (action) {
      case 'pause':
        await pauseDownload(gid);
        logger.info('PATCH /api/files/torrent-download - Download paused', { gid });
        // WebSocket broadcast is handled inside pauseDownload() in webTorrentManager
        return NextResponse.json({ success: true, message: 'Download paused' });

      case 'resume':
        await resumeDownload(gid);
        logger.info('PATCH /api/files/torrent-download - Download resumed', { gid });
        // WebSocket broadcast is handled inside resumeDownload() in webTorrentManager
        return NextResponse.json({ success: true, message: 'Download resumed' });

      case 'remove': {
        const { filesDeleted = false } = (await removeDownload(gid)) || {};
        logger.info('PATCH /api/files/torrent-download - Download removed', { gid, filesDeleted });
        // removeDownload() does NOT broadcast, so we broadcast from here
        if (global.broadcastTorrentDownloadUpdate) {
          global.broadcastTorrentDownloadUpdate({
            type: 'download-removed',
            payload: { gid },
          });
        }
        // filesDeleted is true only for unfinished downloads, whose partial data
        // the service unlinks — the UI tells the user which of the two happened.
        return NextResponse.json({ success: true, filesDeleted, message: 'Download removed' });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('PATCH /api/files/torrent-download - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
