/** @format */

/**
 * WebTorrent Download Manager
 *
 * Manages torrent downloads using WebTorrent. Provides add, pause, resume,
 * and remove operations with real-time progress via WebSocket broadcasts.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. PAUSE/RESUME WORKAROUND:
 *    WebTorrent's built-in torrent.pause() does not reliably stop all network
 *    activity (connections, tracker announces, etc.). Our workaround is to
 *    completely remove the torrent from the WebTorrent client on pause
 *    (client.remove() with destroyStore: false to keep downloaded files).
 *    On resume, we re-add the torrent (client.add()) and WebTorrent
 *    automatically picks up existing files on disk, resuming from where
 *    it left off. Because re-adding creates a NEW torrent object, we must
 *    re-attach all event listeners -- that's why setupTorrentListeners()
 *    exists as the single source of truth for listeners.
 *
 * 2. IN-MEMORY STATE MAPS:
 *    - pausedDownloads: Info for paused downloads removed from WebTorrent
 *    - progressIntervals: Active setInterval refs for 1s progress broadcasts
 *    - downloadMeta: URL + dir + relativePath per infoHash, needed for:
 *      (a) re-adding torrents on resume (needs the original URL/buffer)
 *      (b) persisting state to disk for crash recovery
 *      (c) relative path for frontend directory filtering
 *
 * 3. PERSISTENCE (torrent-downloads.json):
 *    Active and paused downloads are saved to STATE_FILE on every state change.
 *    On server restart, they are restored via restoreDownloads().
 *    Completed/removed downloads are NOT persisted; they are removed immediately
 *    from both WebTorrent and memory.
 *
 * 4. REAL-TIME UPDATES:
 *    Progress is broadcast every 1 second via global.broadcastTorrentDownloadUpdate
 *    (WebSocket, set up in server.js). State-change events (paused, resumed,
 *    completed) are broadcast immediately from the relevant functions.
 *    The PATCH route handler does NOT broadcast for pause/resume (the manager
 *    already does), but DOES broadcast for remove (manager doesn't).
 *
 * 5. PATH HANDLING:
 *    Each download tracks two paths:
 *    - dir: absolute server path where files are written (for WebTorrent)
 *    - relativePath: browser-relative path (for frontend filtering/display)
 *    The API returns relativePath so the frontend can match downloads to
 *    the currently browsed directory.
 */

import { readFile, writeFile } from 'fs/promises';
import { logger } from '@/lib/logger';
import http from 'http';
import https from 'https';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

// Use createRequire to load webtorrent as CJS with proper file path context.
// Dynamic import('webtorrent') causes Bun to lose the path context for
// node-datachannel's native binary require, resulting in 'from ''' errors.
const _require = createRequire(import.meta.url);

// Lazy-load WebTorrent to avoid issues with native modules during build
let WebTorrent = null;
let client = null;

// In-memory state maps (see module docblock for details)
const pausedDownloads = new Map();      // Paused downloads removed from WebTorrent client
const progressIntervals = new Map();    // setInterval refs for progress broadcasts (by gid)
const downloadMeta = new Map();         // URL + dir + relativePath per infoHash
const STATE_FILE = process.env.TORRENT_STATE_FILE || resolve(process.cwd(), './torrent-downloads.json');

/**
 * Initialize WebTorrent client on first use
 */
async function ensureClient() {
  if (client) return client;

  try {
    if (!WebTorrent) {
      const mod = _require('webtorrent');
      WebTorrent = mod.default || mod;
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
    // Save active torrents currently managed by the WebTorrent client
    const active = client
      ? client.torrents.map((t) => ({
          gid: t.infoHash,
          url: downloadMeta.get(t.infoHash)?.url,
          dir: downloadMeta.get(t.infoHash)?.dir,
          relativePath: downloadMeta.get(t.infoHash)?.relativePath,
          name: t.name,
          addedAt: downloadMeta.get(t.infoHash)?.addedAt,
          status: t.paused ? 'paused' : 'active',
        }))
      : [];

    // Also save paused downloads that were removed from WebTorrent
    // (see pause/resume workaround -- paused torrents are removed from the client
    // to fully stop network activity, so they won't appear in client.torrents)
    const paused = Array.from(pausedDownloads.entries()).map(([gid, info]) => ({
      gid,
      url: downloadMeta.get(gid)?.url,
      dir: downloadMeta.get(gid)?.dir,
      relativePath: downloadMeta.get(gid)?.relativePath,
      name: info.name,
      addedAt: downloadMeta.get(gid)?.addedAt,
      status: 'paused',
    }));

    await writeFile(STATE_FILE, JSON.stringify([...active, ...paused], null, 2));
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
      await addDownload(entry.url, { dir: entry.dir, relativePath: entry.relativePath, paused: entry.status === 'paused' }).catch((err) =>
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
  const gid = torrent.infoHash;

  return {
    gid,
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
    path: downloadMeta.get(gid)?.relativePath || '', // Relative path for frontend filtering
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

    // Log tracker URLs immediately after creation for debugging
    // (the metadata event listener above may miss this if metadata is parsed synchronously)
    const gid = torrent.infoHash;
    const trackerInfo = torrent.announce
      ? torrent.announce.map(a => (typeof a === 'string' ? a : a?.url || a)).filter(Boolean)
      : [];
    logger.info('Torrent trackers', {
      gid,
      name: torrent.name,
      isPrivate: !!torrent.private,
      trackerCount: trackerInfo.length,
      trackers: trackerInfo.length <= 5 ? trackerInfo : `${trackerInfo.length} trackers (first: ${trackerInfo[0]})`,
    });

    // For private trackers, disable DHT/PEX/LSD and use ONLY tracker announces.
    // WebTorrent v2 uses `torrent.discovery` (not `discoverer`) for the Discovery instance.
    if (torrent.private) {
      logger.info('Private torrent detected - disabling DHT/PEX', {
        gid,
        name: torrent.name,
        hasDiscovery: !!torrent.discovery,
      });
      // Disable DHT and PEX on the discovery instance for private trackers
      // Note: WebTorrent should handle this automatically via the private flag,
      // but we explicitly disable it to be safe
      if (torrent.discovery) {
        if (torrent.discovery.dht) {
          torrent.discovery.dht.destroy();
          torrent.discovery.dht = null;
          logger.debug('DHT destroyed for private torrent', { gid });
        }
      }

      // Delayed diagnostic: log tracker state after 15 seconds for private torrents
      // This helps debug issues where announces silently fail
      setTimeout(() => {
        if (torrent && !torrent.destroyed && torrent.numPeers === 0) {
          logger.warn('Private torrent has 0 peers after 15 seconds', {
            gid,
            name: torrent.name,
            progress: Math.round(torrent.progress * 100),
            numPeers: torrent.numPeers,
            // Check if the tracker client is present and has trackers
            hasTrackerClient: !!torrent.discovery?.tracker,
            trackerCount: trackerInfo.length,
          });
        }
      }, 15000);
    }
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
    // dir = absolute server path (for WebTorrent file I/O)
    // relativePath = browser-relative path (for frontend filtering/display)
    downloadMeta.set(gid, {
      url,
      dir: options.dir,
      relativePath: options.relativePath || '',
      addedAt: new Date().toISOString(),
    });

    // Attach event listeners BEFORE saving state to disk, so we don't miss
    // early tracker events (especially important for private trackers that
    // may respond quickly with errors)
    setupTorrentListeners(torrent, gid, progressInterval);

    // Save state to disk
    await saveDownloadState();

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

    logger.warn('Download not found', { gid });
    return null;
  } catch (error) {
    logger.warn('Failed to get download status', { error: error.message, gid });
    return null;
  }
}

/**
 * Get all active downloads (non-paused), optionally filtered by relative path.
 * @param {string|null} filterPath - Relative path to filter by (e.g. "user_123/subfolder")
 */
export async function getActiveDownloads(filterPath = null) {
  try {
    const c = await ensureClient();
    return c.torrents
      .filter((t) => {
        if (t.paused) return false;
        if (filterPath != null) {
          const relPath = downloadMeta.get(t.infoHash)?.relativePath || '';
          if (relPath !== filterPath) return false;
        }
        return true;
      })
      .map((t) => formatTorrentInfo(t));
  } catch (error) {
    logger.warn('Failed to get active downloads', { error: error.message });
    return [];
  }
}

/**
 * Get all paused/waiting downloads, optionally filtered by relative path.
 * Includes both paused torrents still in WebTorrent and paused downloads
 * that were removed from WebTorrent (see pause/resume workaround).
 */
export async function getWaitingDownloads(offset = 0, num = 100, filterPath = null) {
  try {
    const c = await ensureClient();

    // Get paused torrents from WebTorrent
    const webTorrentPaused = c.torrents
      .filter((t) => {
        if (!t.paused) return false;
        if (filterPath != null) {
          const relPath = downloadMeta.get(t.infoHash)?.relativePath || '';
          if (relPath !== filterPath) return false;
        }
        return true;
      })
      .map((t) => formatTorrentInfo(t));

    // Get paused downloads that were removed from WebTorrent
    let pausedEntries = Array.from(pausedDownloads.values());
    if (filterPath != null) {
      pausedEntries = pausedEntries.filter((d) => (d.path || '') === filterPath);
    }

    // Combine and slice
    const allWaiting = [...webTorrentPaused, ...pausedEntries];
    return allWaiting.slice(offset, offset + num);
  } catch (error) {
    logger.warn('Failed to get waiting downloads', { error: error.message });
    return [];
  }
}

/**
 * Set up all event listeners for a torrent instance.
 *
 * Called by both addDownload() and resumeDownload() -- this is the single
 * source of truth for torrent event handling. Because the pause/resume
 * workaround creates a NEW torrent object on each resume, we must re-attach
 * all listeners every time.
 *
 * Handles: peer connections, tracker events, download completion (with
 * cleanup, broadcast, and seeding stop), and errors.
 */
function setupTorrentListeners(torrent, gid, progressInterval) {
  // Track peer connections
  torrent.on('peer', (peer) => {
    logger.debug('Peer connected', { gid, name: torrent.name, peer: peer.addr, numPeers: torrent.numPeers });
  });

  // Track peer disconnections
  torrent.on('noPeers', (announceType) => {
    logger.warn('No peers available', {
      gid,
      name: torrent.name,
      announceType,
      totalPeers: torrent.numPeers,
      progress: Math.round(torrent.progress * 100),
    });
  });

  // Track tracker announcements
  torrent.on('trackerAnnounce', () => {
    logger.info('Tracker announce received', {
      gid,
      name: torrent.name,
      numPeers: torrent.numPeers,
      isPrivate: torrent.private,
      trackers: torrent.announce?.length || 0,
    });
  });

  // Log tracker errors -- critical for diagnosing private tracker issues
  torrent.on('trackerError', (error) => {
    logger.error('Tracker error', {
      gid,
      name: torrent.name,
      error: error.message,
      errorCode: error.code,
      statusCode: error.statusCode,
      response: typeof error.response === 'string' ? error.response.substring(0, 300) : undefined,
      isPrivate: torrent.private,
      tracker: error.announce || error.scrape || 'unknown',
    });
  });

  // Log tracker warnings
  torrent.on('trackerWarning', (warning) => {
    logger.warn('Tracker warning', {
      gid,
      name: torrent.name,
      warning: warning.message || warning,
      isPrivate: torrent.private,
    });
  });

  // Set up torrent completion handler (CRITICAL for cleanup)
  torrent.on('done', async () => {
    // Verify torrent is actually complete (progress = 1.0)
    // Sometimes 'done' fires spuriously, especially for resumed torrents
    if (torrent.progress < 1.0) {
      logger.warn('Done event fired but torrent not complete', {
        gid,
        name: torrent.name,
        progress: Math.round(torrent.progress * 100),
      });
      return;
    }

    logger.info('Download completed', { gid: torrent.infoHash, name: torrent.name });
    clearInterval(progressInterval);
    progressIntervals.delete(gid);

    // Get relative path before cleanup (used by frontend to refresh the directory)
    const completedRelativePath = downloadMeta.get(gid)?.relativePath || '';

    // Clean up state - remove from both WebTorrent and memory
    downloadMeta.delete(gid);
    await saveDownloadState();

    // Broadcast download completion to UI (frontend will remove it from downloads list)
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-complete',
        payload: {
          gid,
          targetPath: completedRelativePath,
        },
      });
    }

    // Stop seeding - remove torrent from client without deleting files
    if (client && !torrent.destroyed) {
      client.remove(torrent.infoHash, { destroyStore: false });
      logger.info('Stopped seeding and removed from client after completion', { gid, name: torrent.name });
    }
  });

  // Set up error handler -- also clean up metadata and persist state
  torrent.on('error', async (error) => {
    logger.error('Torrent error', {
      gid,
      name: torrent.name,
      error: error.message,
      code: error.code,
    });
    clearInterval(progressInterval);
    progressIntervals.delete(gid);
    downloadMeta.delete(gid);
    await saveDownloadState();
  });
}

/**
 * Pause a download by removing it from the WebTorrent client entirely.
 *
 * WHY NOT torrent.pause()?
 * WebTorrent's pause() doesn't reliably stop network activity. Instead we:
 * 1. Capture current state (formatTorrentInfo)
 * 2. Clear the progress broadcast interval
 * 3. Remove all event listeners (prevent memory leaks)
 * 4. Remove torrent from client (destroyStore: false keeps files on disk)
 * 5. Store info in pausedDownloads Map (for UI display)
 * 6. Broadcast 'download-paused' via WebSocket
 * 7. Persist to disk so paused downloads survive server restart
 *
 * See resumeDownload() for the reverse process.
 */
export async function pauseDownload(gid) {
  try {
    const c = await ensureClient();
    const torrent = c.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      throw new Error(`Download not found: ${gid}`);
    }

    logger.info('Pausing download (removing from WebTorrent)', {
      gid,
      name: torrent.name,
      progress: Math.round(torrent.progress * 100),
      downloaded: formatBytes(torrent.downloaded || 0),
    });

    // Store final state before removing
    const downloadInfo = formatTorrentInfo(torrent);

    // Clear the progress interval for this torrent
    const interval = progressIntervals.get(gid);
    if (interval) {
      clearInterval(interval);
      progressIntervals.delete(gid);
    }

    // Remove all event listeners to prevent memory leaks
    if (torrent && !torrent.destroyed) {
      try {
        torrent.removeAllListeners();
      } catch (e) {
        logger.debug('Error removing listeners during pause', { error: e.message });
      }
    }

    // Completely remove torrent from WebTorrent (stops all activity)
    // Pass destroyStore: false to keep downloaded files intact
    if (client && !torrent.destroyed) {
      client.remove(torrent.infoHash, { destroyStore: false });
    }

    // Mark as paused and store in pausedDownloads Map
    downloadInfo.status = 'paused';
    pausedDownloads.set(gid, downloadInfo);

    // Broadcast paused status
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-paused',
        payload: downloadInfo,
      });
    }

    // Persist pause state to disk
    await saveDownloadState();

    logger.info('Download paused successfully (removed from WebTorrent)', {
      gid,
      name: torrent.name,
    });

    return true;
  } catch (error) {
    logger.error('Failed to pause download', { error: error.message, gid });
    throw error;
  }
}

/**
 * Resume a paused download by re-adding it to the WebTorrent client.
 *
 * Since pause removes the torrent entirely (see pauseDownload), resume must:
 * 1. Look up the original URL from downloadMeta
 * 2. Re-add the torrent to WebTorrent (client.add)
 *    - For file:// URLs: re-read the .torrent file into a buffer
 *    - For magnet links: pass the magnet URI directly
 * 3. WebTorrent detects existing files on disk and skips already-downloaded pieces
 * 4. Re-create the progress broadcast interval
 * 5. Re-attach all event listeners via setupTorrentListeners()
 * 6. Remove from pausedDownloads Map
 * 7. Broadcast 'download-resumed' via WebSocket
 */
export async function resumeDownload(gid) {
  try {
    const c = await ensureClient();

    // Check if torrent is already in WebTorrent
    let torrent = c.torrents.find((t) => t.infoHash === gid);

    if (!torrent) {
      // Torrent was removed when paused, need to re-add it
      const meta = downloadMeta.get(gid);
      if (!meta || !meta.url) {
        throw new Error(`Cannot resume: no metadata found for ${gid}`);
      }

      logger.info('Re-adding torrent to WebTorrent for resume', {
        gid,
        url: meta.url.substring(0, 50) + '...',
        dir: meta.dir,
      });

      // Re-add the torrent with the same options
      // First, prepare the add target (convert file:// URLs to buffer like on initial add)
      let addTarget = meta.url;
      if (meta.url.startsWith('file://')) {
        // Convert file:// URL to buffer for WebTorrent
        const filePath = meta.url.slice(7); // Remove 'file://' prefix
        addTarget = await readFile(filePath);
        logger.debug('Re-adding torrent file from buffer', { filePath });
      }

      torrent = await new Promise((resolve, reject) => {
        let timeoutId = setTimeout(() => {
          reject(new Error('Timeout re-adding torrent - c.add() callback never called'));
        }, 10000);

        try {
          c.add(addTarget, { path: meta.dir }, (addedTorrent) => {
            clearTimeout(timeoutId);
            if (!addedTorrent) {
              reject(new Error('c.add() returned null torrent'));
            } else if (addedTorrent.destroyed) {
              reject(new Error('c.add() returned destroyed torrent'));
            } else {
              resolve(addedTorrent);
            }
          });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`c.add() threw error: ${err.message}`));
        }
      });

      logger.info('Torrent re-added successfully', {
        gid: torrent.infoHash,
        name: torrent.name,
      });

      // Wait a moment for torrent to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check files to rebuild download state
      logger.debug('Checking files to rebuild download state', {
        gid: torrent.infoHash,
        name: torrent.name,
      });
    }

    logger.info('Resuming download', {
      gid: torrent.infoHash,
      name: torrent.name,
      progress: Math.round(torrent.progress * 100),
      downloaded: formatBytes(torrent.downloaded || 0),
    });

    // Remove from paused downloads since we're resuming
    pausedDownloads.delete(gid);

    // Set up progress interval if it doesn't exist
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

      // Set up event listeners for the resumed torrent
      setupTorrentListeners(torrent, gid, progressInterval);
    }

    // Send immediate status update
    const info = formatTorrentInfo(torrent);
    if (global.broadcastTorrentDownloadUpdate) {
      global.broadcastTorrentDownloadUpdate({
        type: 'download-resumed',
        payload: info,
      });
    }

    // Persist resume state to disk
    await saveDownloadState();

    logger.info('Download resumed successfully', {
      gid: torrent.infoHash,
      name: torrent.name,
      peers: torrent.numPeers,
    });

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

    // Handle paused downloads (not in c.torrents anymore)
    if (!torrent) {
      // Check if it's a paused download
      const pausedInfo = pausedDownloads.get(gid);
      if (pausedInfo) {
        logger.info('Removing paused download', { gid, name: pausedInfo.name });
        pausedDownloads.delete(gid);
        downloadMeta.delete(gid);
        await saveDownloadState();
        return true;
      }

      throw new Error(`Download not found: ${gid}`);
    }

    // Handle active downloads (in c.torrents)
    // Clean up progress interval
    const interval = progressIntervals.get(gid);
    if (interval) {
      clearInterval(interval);
      progressIntervals.delete(gid);
    }

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
