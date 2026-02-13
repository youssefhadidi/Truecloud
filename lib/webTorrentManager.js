/** @format */

import { readFile } from 'fs/promises';
import { logger } from '@/lib/logger';

// Lazy-load WebTorrent to avoid issues with native modules during build
let WebTorrent = null;
let client = null;
const stoppedDownloads = new Map();
const progressIntervals = new Map(); // Track progress intervals by gid
const MAX_STOPPED_HISTORY = 50;

/**
 * Initialize WebTorrent client on first use
 */
async function ensureClient() {
  if (client) return client;

  try {
    if (!WebTorrent) {
      const mod = await import('webtorrent');
      WebTorrent = mod.default;
    }

    // Initialize with configuration for better peer discovery
    client = new WebTorrent({
      dht: true,        // Enable DHT for peer discovery
      pex: true,        // Enable PEX (Peer Exchange) protocol
      tracker: true,    // Enable tracker support
      maxConns: 100,    // Max concurrent connections
      maxPeers: 100,    // Max peers per torrent
    });

    logger.info('WebTorrent client initialized', {
      dhtEnabled: true,
      pexEnabled: true,
      trackerEnabled: true,
    });
    return client;
  } catch (error) {
    logger.error('Failed to initialize WebTorrent client', { error: error.message });
    throw new Error(`WebTorrent initialization failed: ${error.message}`);
  }
}

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
    const c = await ensureClient();
    let torrent;

    // Handle magnet links
    if (url.startsWith('magnet:')) {
      logger.info('Adding magnet link download', { magnet: url });
      torrent = await new Promise((resolve, reject) => {
        const t = c.add(url, { path: options.dir }, (torrent) => {
          resolve(torrent);
        });

        // Log metadata loading progress
        t.on('metadata', () => {
          logger.info('Magnet metadata loaded', {
            infoHash: t.infoHash,
            name: t.name,
            length: t.length,
            numPeers: t.numPeers,
          });
        });

        t.on('ready', () => {
          logger.info('Torrent ready for download', {
            infoHash: t.infoHash,
            name: t.name,
            numPeers: t.numPeers,
          });
        });

        t.on('error', reject);

        // Timeout after 60 seconds if torrent doesn't load metadata
        const timeout = setTimeout(() => {
          logger.error('Magnet metadata timeout', {
            infoHash: t.infoHash,
            numPeers: t.numPeers,
            downloadSpeed: t.downloadSpeed,
          });
          reject(new Error('Magnet link metadata timeout - no peers available'));
        }, 60000);

        t.on('metadata', () => clearTimeout(timeout));
      });
    }
    // Handle file:// URLs (torrent files)
    else if (url.startsWith('file://')) {
      const filePath = url.slice(7); // Remove 'file://' prefix
      logger.info('Adding torrent file download', { path: filePath });

      const buffer = await readFile(filePath);
      torrent = await new Promise((resolve, reject) => {
        const t = c.add(buffer, { path: options.dir }, (torrent) => {
          resolve(torrent);
        });
        t.on('error', reject);
      });
    }
    else {
      throw new Error(`Unsupported URL type: ${url.startsWith('http') ? 'HTTP/HTTPS downloads are no longer supported' : 'unknown format'}`);
    }

    // Broadcast progress updates every second
    const gid = torrent.infoHash;
    let lastLoggedPeers = -1;

    const progressInterval = setInterval(() => {
      if (torrent && !torrent.destroyed) {
        const info = formatTorrentInfo(torrent);

        // Log peer/seed count changes for diagnostics
        if (torrent.numPeers !== lastLoggedPeers && (torrent.numPeers > 0 || lastLoggedPeers === -1)) {
          logger.debug('Torrent peers update', {
            gid,
            name: torrent.name,
            peers: torrent.numPeers,
            downloaded: formatBytes(torrent.downloaded || 0),
            downloadSpeed: formatBytes(torrent.downloadSpeed || 0),
            progress: Math.round(torrent.progress * 100) || 0,
          });
          lastLoggedPeers = torrent.numPeers;
        }

        if (global.broadcastTorrentDownloadUpdate) {
          global.broadcastTorrentDownloadUpdate({
            type: 'download-progress',
            payload: info,
          });
        }
      }
    }, 1000);
    progressIntervals.set(gid, progressInterval);

    // Track peer connections
    torrent.on('peer', (peer) => {
      logger.debug('Peer connected', { gid, name: torrent.name, peer: peer.addr, numPeers: torrent.numPeers });
    });

    // Track peer disconnections
    torrent.on('noPeers', (announceType) => {
      logger.warn('No peers available', {
        gid,
        name: torrent.name,
        announceType, // 'tracker' or 'dht' or 'pex'
        totalPeers: torrent.numPeers
      });
    });

    // Set up torrent completion handler
    torrent.on('done', () => {
      logger.info('Download completed', { gid: torrent.infoHash, name: torrent.name });
      clearInterval(progressInterval);
      progressIntervals.delete(gid);

      // Move to stopped downloads when complete
      const info = formatTorrentInfo(torrent);
      info.status = 'complete';
      stoppedDownloads.set(torrent.infoHash, info);

      // Broadcast final status
      if (global.broadcastTorrentDownloadUpdate) {
        global.broadcastTorrentDownloadUpdate({
          type: 'download-progress',
          payload: info,
        });
      }

      // Prune oldest entries if we exceed max history
      if (stoppedDownloads.size > MAX_STOPPED_HISTORY) {
        const firstKey = stoppedDownloads.keys().next().value;
        stoppedDownloads.delete(firstKey);
      }
    });

    // Clean up interval on error
    torrent.on('error', (err) => {
      logger.warn('Torrent error', { gid, error: err.message });
      clearInterval(progressInterval);
      progressIntervals.delete(gid);
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
    const c = await ensureClient();
    const torrent = c.torrents.find((t) => t.infoHash === gid);

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
    const c = await ensureClient();
    return c.torrents
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
    const c = await ensureClient();
    return c.torrents
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
    const c = await ensureClient();
    const torrent = c.torrents.find((t) => t.infoHash === gid);

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
    const c = await ensureClient();
    const torrent = c.torrents.find((t) => t.infoHash === gid);

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
    const c = await ensureClient();
    const torrent = c.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      throw new Error(`Download not found: ${gid}`);
    }

    // Clean up progress interval
    const interval = progressIntervals.get(gid);
    if (interval) {
      clearInterval(interval);
      progressIntervals.delete(gid);
    }

    // Store final info before removing
    const info = formatTorrentInfo(torrent);
    info.status = 'removed';
    stoppedDownloads.set(gid, info);

    // Remove from client
    c.remove(gid);

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
  if (client) {
    client.destroy();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, destroying WebTorrent client');
  if (client) {
    client.destroy();
  }
  process.exit(0);
});

logger.info('WebTorrent manager loaded (lazy initialization)');
