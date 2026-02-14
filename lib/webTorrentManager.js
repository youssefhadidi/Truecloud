/** @format */

import { readFile, writeFile } from 'fs/promises';
import { logger } from '@/lib/logger';
import http from 'http';
import https from 'https';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Lazy-load WebTorrent to avoid issues with native modules during build
let WebTorrent = null;
let client = null;
const stoppedDownloads = new Map();
const progressIntervals = new Map(); // Track progress intervals by gid
const downloadMeta = new Map(); // Store URL+dir per infoHash for persistence
const MAX_STOPPED_HISTORY = 50;
const STATE_FILE = process.env.TORRENT_STATE_FILE || resolve(process.cwd(), './torrent-downloads.json');

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

    // Generate proper 20-byte IDs for DHT and peer announcements
    // Use qBittorrent format: -qB<version>-<random>
    // Format: -qB4600- (qBittorrent v4.6.0) + 12 random bytes = 20 bytes total
    const generateId = () => {
      const randomBytes = Buffer.alloc(12);
      for (let i = 0; i < 12; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256);
      }
      return Buffer.concat([
        Buffer.from('-qB4600-'), // 8 bytes: qBittorrent 4.6.0 identifier
        randomBytes                // 12 bytes: random data
      ]);
    };

    // Initialize with configuration for public and private torrent support
    client = new WebTorrent({
      dht: true,        // Enable DHT for public torrent peer discovery
      pex: true,        // Enable PEX (Peer Exchange) protocol
      tracker: {        // Configure tracker with proper HTTP User-Agent for private tracker compatibility
        userAgent: 'qBittorrent/4.6.0',  // Spoof qBittorrent user agent in HTTP requests
      },
      maxConns: 100,    // Max concurrent connections
      maxPeers: 100,    // Max peers per torrent
      ports: [6881, 6882],  // Use fixed ports for consistent firewall configuration
      nodeId: generateId(),  // 20-byte DHT node ID
      peerId: generateId(),  // 20-byte peer ID for announcements
    });

    logger.info('WebTorrent client initialized', {
      dhtEnabled: true,
      pexEnabled: true,
      trackerEnabled: true,
      clientIdentity: 'qBittorrent 4.6.0',
    });

    // Restore incomplete downloads from previous session
    await restoreDownloads();

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
 * Test tracker connectivity by making a direct HTTP announce request
 */
export async function testTrackerConnectivity(trackerUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(trackerUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      logger.info('Testing tracker connectivity', { trackerUrl });

      const request = protocol.get(trackerUrl, {
        headers: {
          'User-Agent': 'qBittorrent/4.6.0',
        },
        timeout: 10000,
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          logger.info('Tracker response received', {
            trackerUrl,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            bodyLength: data.length,
            bodyPreview: data.substring(0, 200),
          });
          resolve({
            success: response.statusCode === 200,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            body: data,
          });
        });
      });

      request.on('error', (error) => {
        logger.error('Tracker connection error', {
          trackerUrl,
          error: error.message,
          code: error.code,
        });
        resolve({
          success: false,
          error: error.message,
          code: error.code,
        });
      });

      request.on('timeout', () => {
        request.destroy();
        logger.error('Tracker connection timeout', { trackerUrl });
        resolve({
          success: false,
          error: 'Connection timeout',
        });
      });
    } catch (error) {
      logger.error('Tracker test error', {
        trackerUrl,
        error: error.message,
      });
      resolve({
        success: false,
        error: error.message,
      });
    }
  });
}

/**
 * Save download state to disk for persistence across restarts
 */
async function saveDownloadState() {
  try {
    const active = client
      ? client.torrents.map((t) => ({
          gid: t.infoHash,
          url: downloadMeta.get(t.infoHash)?.url,
          dir: downloadMeta.get(t.infoHash)?.dir,
          name: t.name,
          addedAt: downloadMeta.get(t.infoHash)?.addedAt,
          status: t.paused ? 'paused' : 'active',
        }))
      : [];
    await writeFile(STATE_FILE, JSON.stringify(active, null, 2));
  } catch (error) {
    logger.error('Failed to save download state', { error: error.message });
  }
}

/**
 * Restore incomplete downloads from disk after restart
 */
async function restoreDownloads() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const saved = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    for (const entry of saved) {
      // Skip completed downloads - only restore active/paused ones
      if (entry.status !== 'active' && entry.status !== 'paused') continue;
      logger.info('Restoring torrent download', { name: entry.name, gid: entry.gid, wasStatus: entry.status });
      await addDownload(entry.url, { dir: entry.dir, paused: entry.status === 'paused' }).catch((err) =>
        logger.warn('Failed to restore torrent', { gid: entry.gid, error: err.message })
      );
    }
  } catch (error) {
    logger.error('Failed to restore downloads', { error: error.message });
  }
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
        const t = c.add(url, {
          path: options.dir,
        }, (torrent) => {
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

        // Timeout after 120 seconds if torrent doesn't load metadata (longer for private trackers)
        const timeout = setTimeout(() => {
          logger.error('Magnet metadata timeout', {
            infoHash: t.infoHash,
            numPeers: t.numPeers,
            downloadSpeed: t.downloadSpeed,
          });
          reject(new Error('Magnet link metadata timeout - no peers available'));
        }, 120000);

        t.on('metadata', () => clearTimeout(timeout));
      });
    }
    // Handle file:// URLs (torrent files)
    else if (url.startsWith('file://')) {
      const filePath = url.slice(7); // Remove 'file://' prefix
      logger.info('Adding torrent file download', { path: filePath });

      const buffer = await readFile(filePath);
      torrent = await new Promise((resolve, reject) => {
        const t = c.add(buffer, {
          path: options.dir,
        }, (torrent) => {
          resolve(torrent);
        });

        t.on('metadata', () => {
          const trackerUrls = t.announce ? t.announce.map(a => a.url || a).filter(u => u) : [];
          logger.info('Torrent file metadata loaded', {
            infoHash: t.infoHash,
            name: t.name,
            length: t.length,
            numPeers: t.numPeers,
            isPrivate: t.private,
            trackers: trackerUrls.length,
            // Log first tracker for auth debugging (may contain user:pass)
            primaryTracker: trackerUrls[0] ? (typeof trackerUrls[0] === 'string' ? trackerUrls[0] : trackerUrls[0].url) : 'none',
            allTrackers: trackerUrls.length <= 3 ? trackerUrls : `${trackerUrls.length} trackers`,
          });
        });

        t.on('error', reject);
      });
    }
    else {
      throw new Error(`Unsupported URL type: ${url.startsWith('http') ? 'HTTP/HTTPS downloads are no longer supported' : 'unknown format'}`);
    }

    // For private trackers, disable DHT/PEX/LSD and use ONLY tracker announces
    if (torrent.private) {
      logger.info('Private torrent detected - disabling DHT/PEX/LSD', {
        gid: torrent.infoHash,
        name: torrent.name,
      });
      // Disable peer discovery mechanisms for private trackers
      if (torrent.discoverer) {
        torrent.discoverer.destroy();
      }
    }

    // Pause torrent if this is a restore from a paused state
    const gid = torrent.infoHash;
    if (options.paused) {
      torrent.pause();
      logger.info('Restored torrent in paused state', { gid, name: torrent.name });
    }

    // Broadcast progress updates every second
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

    // Store metadata for persistence across restarts
    downloadMeta.set(gid, {
      url,
      dir: options.dir,
      addedAt: new Date().toISOString(),
    });

    // Save state to disk
    await saveDownloadState();

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
        totalPeers: torrent.numPeers,
        progress: Math.round(torrent.progress * 100),
      });
    });

    // Track tracker announcements (important for private trackers)
    torrent.on('trackerAnnounce', () => {
      logger.info('Tracker announcement received', {
        gid,
        name: torrent.name,
        numPeers: torrent.numPeers,
        isPrivate: torrent.private,
        trackers: torrent.announce?.length || 0,
      });
    });

    // Log detailed tracker errors and warnings
    torrent.on('trackerError', (error) => {
      logger.error('Tracker HTTP error', {
        gid,
        name: torrent.name,
        error: error.message,
        errorCode: error.code,
        statusCode: error.statusCode,
        response: error.response?.substring?.(0, 200) || error.response,
        isPrivate: torrent.private,
      });
    });

    // Log all tracker events for debugging
    torrent.on('trackerWarning', (warning) => {
      logger.warn('Tracker warning', {
        gid,
        name: torrent.name,
        warning: warning.message || warning,
      });
    });

    // Log successful tracker announces
    torrent.on('trackerAnnounce', () => {
      logger.info('Tracker announce successful', {
        gid,
        name: torrent.name,
        numPeers: torrent.numPeers,
      });
    });

    // Set up torrent completion handler
    torrent.on('done', async () => {
      logger.info('Download completed', { gid: torrent.infoHash, name: torrent.name });
      clearInterval(progressInterval);
      progressIntervals.delete(gid);

      // Move to stopped downloads when complete
      const info = formatTorrentInfo(torrent);
      info.status = 'complete';
      stoppedDownloads.set(torrent.infoHash, info);

      // Save state immediately to prevent restore loop if server restarts during shutdown
      downloadMeta.delete(gid);
      await saveDownloadState();

      // Broadcast download completion to UI with target path
      if (global.broadcastTorrentDownloadUpdate) {
        global.broadcastTorrentDownloadUpdate({
          type: 'download-complete',
          payload: {
            ...info,
            targetPath: downloadMeta.get(gid)?.dir,
          },
        });
      }

      // Stop seeding - remove torrent from client without deleting files
      setTimeout(async () => {
        if (client && !torrent.destroyed) {
          client.remove(torrent.infoHash, { destroyStore: false });
          logger.info('Stopped seeding after completion', { gid, name: torrent.name });
        }
      }, 2000); // short delay to allow final broadcast

      // Prune oldest entries if we exceed max history
      if (stoppedDownloads.size > MAX_STOPPED_HISTORY) {
        const firstKey = stoppedDownloads.keys().next().value;
        stoppedDownloads.delete(firstKey);
      }
    });

    // Clean up interval on error
    torrent.on('error', async (err) => {
      logger.warn('Torrent error', { gid, error: err.message });
      clearInterval(progressInterval);
      progressIntervals.delete(gid);
      downloadMeta.delete(gid);
      await saveDownloadState();
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

    // Clear progress interval to stop broadcasting updates while paused
    const interval = progressIntervals.get(gid);
    if (interval) {
      clearInterval(interval);
    }

    // Broadcast status update with zero download speed to reflect paused state
    const info = formatTorrentInfo(torrent);
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-progress',
        payload: info,
      });
    }

    logger.info('Download paused', { gid, stopped: true });
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

    // Send immediate status update with current progress
    const info = formatTorrentInfo(torrent);
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-progress',
        payload: info,
      });
    }

    // Restart progress interval
    if (!progressIntervals.has(gid)) {
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
    }

    logger.info('Download resumed', { gid, streaming: true });
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

    // Clean up metadata and save state
    downloadMeta.delete(gid);
    await saveDownloadState();

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
