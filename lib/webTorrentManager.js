/** @format */

import WebTorrent from 'webtorrent';
import { readFile } from 'fs/promises';
import { logger } from '@/lib/logger';

const client = new WebTorrent();

// Track completed/removed torrents in memory
const stoppedDownloads = new Map();
const MAX_STOPPED_HISTORY = 50;

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format a torrent object to the download info shape
 */
function formatTorrentInfo(torrent) {
  const progress = torrent.progress ? Math.round(torrent.progress * 100) : 0;
  const downloadSpeed = torrent.downloadSpeed || 0;
  const uploadSpeed = torrent.uploadSpeed || 0;

  return {
    gid: torrent.infoHash,
    name: torrent.name || 'Unknown',
    status: torrent.paused ? 'paused' : 'active',
    progress,
    downloadSpeed: formatBytes(downloadSpeed) + '/s',
    downloaded: formatBytes(torrent.downloaded || 0),
    totalSize: formatBytes(torrent.length || 0),
    error: null,
    errorCode: null,
    isTorrent: true,
    infoHash: torrent.infoHash,
    uploadSpeed: formatBytes(uploadSpeed) + '/s',
    seeders: torrent.numPeers || 0,
    peers: torrent.numPeers || 0,
  };
}

/**
 * Add a new torrent download (magnet link or .torrent file)
 */
export async function addDownload(url, options = {}) {
  try {
    let torrent;

    // Handle magnet links
    if (url.startsWith('magnet:')) {
      logger.info('Adding magnet link download', { magnet: url });
      torrent = await new Promise((resolve, reject) => {
        const t = client.add(url, { path: options.dir }, (torrent) => {
          resolve(torrent);
        });
        t.on('error', reject);

        // Timeout after 30 seconds if torrent doesn't load metadata
        const timeout = setTimeout(() => {
          reject(new Error('Magnet link metadata timeout'));
        }, 30000);

        t.on('metadata', () => clearTimeout(timeout));
      });
    }
    // Handle file:// URLs (torrent files)
    else if (url.startsWith('file://')) {
      const filePath = url.slice(7); // Remove 'file://' prefix
      logger.info('Adding torrent file download', { path: filePath });

      const buffer = await readFile(filePath);
      torrent = await new Promise((resolve, reject) => {
        const t = client.add(buffer, { path: options.dir }, (torrent) => {
          resolve(torrent);
        });
        t.on('error', reject);
      });
    }
    else {
      throw new Error(`Unsupported URL type: ${url.startsWith('http') ? 'HTTP/HTTPS downloads are no longer supported' : 'unknown format'}`);
    }

    // Set up torrent completion handler
    torrent.on('done', () => {
      logger.info('Download completed', { gid: torrent.infoHash, name: torrent.name });
      // Move to stopped downloads when complete
      const info = formatTorrentInfo(torrent);
      info.status = 'complete';
      stoppedDownloads.set(torrent.infoHash, info);

      // Prune oldest entries if we exceed max history
      if (stoppedDownloads.size > MAX_STOPPED_HISTORY) {
        const firstKey = stoppedDownloads.keys().next().value;
        stoppedDownloads.delete(firstKey);
      }
    });

    logger.info('Download added', { gid: torrent.infoHash, name: torrent.name });
    return torrent.infoHash;
  } catch (error) {
    logger.error('Failed to add download', { error: error.message, url });
    throw error;
  }
}

/**
 * Get download status by gid (infoHash)
 */
export async function getDownloadStatus(gid) {
  try {
    const torrent = client.torrents.find((t) => t.infoHash === gid);

    if (torrent) {
      return formatTorrentInfo(torrent);
    }

    // Check stopped downloads
    if (stoppedDownloads.has(gid)) {
      return stoppedDownloads.get(gid);
    }

    logger.warn('Download not found', { gid });
    return null;
  } catch (error) {
    logger.warn('Failed to get download status', { error: error.message, gid });
    return null;
  }
}

/**
 * Get all active downloads (non-paused)
 */
export async function getActiveDownloads() {
  try {
    return client.torrents
      .filter((t) => !t.paused && !stoppedDownloads.has(t.infoHash))
      .map((t) => formatTorrentInfo(t));
  } catch (error) {
    logger.warn('Failed to get active downloads', { error: error.message });
    return [];
  }
}

/**
 * Get all paused/waiting downloads
 */
export async function getWaitingDownloads(offset = 0, num = 100) {
  try {
    return client.torrents
      .filter((t) => t.paused && !stoppedDownloads.has(t.infoHash))
      .slice(offset, offset + num)
      .map((t) => formatTorrentInfo(t));
  } catch (error) {
    logger.warn('Failed to get waiting downloads', { error: error.message });
    return [];
  }
}

/**
 * Get all stopped downloads (completed, removed, or failed)
 */
export async function getStoppedDownloads(offset = 0, num = 100) {
  try {
    const entries = Array.from(stoppedDownloads.values()).slice(offset, offset + num);
    return entries;
  } catch (error) {
    logger.warn('Failed to get stopped downloads', { error: error.message });
    return [];
  }
}

/**
 * Pause a download
 */
export async function pauseDownload(gid) {
  try {
    const torrent = client.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      throw new Error(`Download not found: ${gid}`);
    }

    torrent.pause();
    logger.info('Download paused', { gid });
    return true;
  } catch (error) {
    logger.error('Failed to pause download', { error: error.message, gid });
    throw error;
  }
}

/**
 * Resume a download
 */
export async function resumeDownload(gid) {
  try {
    const torrent = client.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      throw new Error(`Download not found: ${gid}`);
    }

    torrent.resume();
    logger.info('Download resumed', { gid });
    return true;
  } catch (error) {
    logger.error('Failed to resume download', { error: error.message, gid });
    throw error;
  }
}

/**
 * Remove a download
 */
export async function removeDownload(gid) {
  try {
    const torrent = client.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      throw new Error(`Download not found: ${gid}`);
    }

    // Store final info before removing
    const info = formatTorrentInfo(torrent);
    info.status = 'removed';
    stoppedDownloads.set(gid, info);

    // Remove from client
    client.remove(gid);

    logger.info('Download removed', { gid });
    return true;
  } catch (error) {
    logger.error('Failed to remove download', { error: error.message, gid });
    throw error;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, destroying WebTorrent client');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, destroying WebTorrent client');
  client.destroy();
  process.exit(0);
});

logger.info('WebTorrent manager initialized');
