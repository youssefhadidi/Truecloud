/**
 * Torrent Worker — runs in a plain Node.js child process.
 *
 * Bun's ESM-CJS interop loses __dirname for native addons loaded transitively
 * through ESM (webtorrent → simple-peer → webrtc-polyfill → node-datachannel).
 * Node.js has no such issue, so we isolate all WebTorrent logic here.
 *
 * Protocol (newline-delimited JSON over stdio):
 *   stdin  ← { id, method, params[] }          (commands from parent)
 *   stdout → { id, result }  or { id, error }   (command responses)
 *   stdout → { type: 'torrent-event', payload }  (push events)
 *   stderr → log lines (inherited by parent console)
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import http from 'http';
import https from 'https';
import WebTorrent from 'webtorrent';

// Simple logger — writes to stderr so it appears in the parent console
// without polluting the stdout IPC channel.
const logger = {
  info:  (msg, meta) => process.stderr.write(`[torrent-worker] INFO  ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
  warn:  (msg, meta) => process.stderr.write(`[torrent-worker] WARN  ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
  error: (msg, meta) => process.stderr.write(`[torrent-worker] ERROR ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
  debug: (msg, meta) => process.stderr.write(`[torrent-worker] DEBUG ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
};

// Send a push event to the parent (Bun) process
function writeEvent(payload) {
  process.stdout.write(JSON.stringify({ type: 'torrent-event', payload }) + '\n');
}

// Send a command response to the parent
function writeResponse(id, result, error) {
  if (error !== undefined) {
    process.stdout.write(JSON.stringify({ id, error: error?.message || String(error) }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ id, result: result ?? null }) + '\n');
  }
}

let client = null;

const pausedDownloads = new Map();
const progressIntervals = new Map();
const downloadMeta = new Map();
const STATE_FILE = process.env.TORRENT_STATE_FILE || resolve(process.cwd(), './torrent-downloads.json');

async function ensureClient() {
  if (client) return client;

  const generateId = () => {
    const randomBytes = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) randomBytes[i] = Math.floor(Math.random() * 256);
    return Buffer.concat([Buffer.from('-qB4600-'), randomBytes]);
  };

  client = new WebTorrent({
    dht: true,
    pex: true,
    tracker: { userAgent: 'qBittorrent/4.6.0' },
    maxConns: 100,
    maxPeers: 100,
    ports: [6881, 6882],
    nodeId: generateId(),
    peerId: generateId(),
  });

  logger.info('WebTorrent client initialized');
  await restoreDownloads();
  return client;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function testTrackerConnectivity(trackerUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(trackerUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      const request = protocol.get(trackerUrl, { headers: { 'User-Agent': 'qBittorrent/4.6.0' }, timeout: 10000 }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          resolve({ success: response.statusCode === 200, statusCode: response.statusCode, statusMessage: response.statusMessage, body: data });
        });
      });

      request.on('error', (error) => resolve({ success: false, error: error.message, code: error.code }));
      request.on('timeout', () => { request.destroy(); resolve({ success: false, error: 'Connection timeout' }); });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

async function saveDownloadState() {
  try {
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

async function restoreDownloads() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const saved = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    for (const entry of saved) {
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

function formatTorrentInfo(torrent) {
  const gid = torrent.infoHash;
  return {
    gid,
    name: torrent.name || 'Unknown',
    status: torrent.paused ? 'paused' : 'active',
    progress: torrent.progress ? Math.round(torrent.progress * 100) : 0,
    downloadSpeed: formatBytes(torrent.downloadSpeed || 0) + '/s',
    downloaded: formatBytes(torrent.downloaded || 0),
    totalSize: formatBytes(torrent.length || 0),
    error: null,
    errorCode: null,
    isTorrent: true,
    infoHash: torrent.infoHash,
    uploadSpeed: formatBytes(torrent.uploadSpeed || 0) + '/s',
    seeders: torrent.numPeers || 0,
    peers: torrent.numPeers || 0,
    path: downloadMeta.get(gid)?.relativePath || '',
  };
}

function setupTorrentListeners(torrent, gid, progressInterval) {
  torrent.on('peer', (peer) => {
    logger.debug('Peer connected', { gid, peer: peer.addr, numPeers: torrent.numPeers });
  });

  torrent.on('noPeers', (announceType) => {
    logger.warn('No peers available', { gid, announceType, totalPeers: torrent.numPeers });
  });

  torrent.on('trackerAnnounce', () => {
    logger.info('Tracker announce', { gid, numPeers: torrent.numPeers });
  });

  torrent.on('trackerError', (error) => {
    logger.error('Tracker error', { gid, error: error.message, tracker: error.announce || 'unknown' });
  });

  torrent.on('trackerWarning', (warning) => {
    logger.warn('Tracker warning', { gid, warning: warning.message || warning });
  });

  torrent.on('done', async () => {
    if (torrent.progress < 1.0) return;

    logger.info('Download completed', { gid, name: torrent.name });
    clearInterval(progressInterval);
    progressIntervals.delete(gid);

    const completedRelativePath = downloadMeta.get(gid)?.relativePath || '';
    downloadMeta.delete(gid);
    await saveDownloadState();

    writeEvent({ type: 'download-complete', payload: { gid, targetPath: completedRelativePath } });

    if (client && !torrent.destroyed) {
      client.remove(torrent.infoHash, { destroyStore: false });
    }
  });

  torrent.on('error', async (error) => {
    logger.error('Torrent error', { gid, error: error.message });
    clearInterval(progressInterval);
    progressIntervals.delete(gid);
    downloadMeta.delete(gid);
    await saveDownloadState();
  });
}

async function addDownload(url, options = {}) {
  const c = await ensureClient();
  let torrent;

  if (url.startsWith('magnet:')) {
    logger.info('Adding magnet link', { magnet: url.substring(0, 60) });
    torrent = await new Promise((resolve, reject) => {
      const t = c.add(url, { path: options.dir }, (torrent) => resolve(torrent));
      t.on('error', reject);
      const timeout = setTimeout(() => reject(new Error('Magnet link metadata timeout - no peers available')), 120000);
      t.on('metadata', () => clearTimeout(timeout));
    });
  } else if (url.startsWith('file://')) {
    const filePath = url.slice(7);
    logger.info('Adding torrent file', { path: filePath });
    const buffer = await readFile(filePath);
    torrent = await new Promise((resolve, reject) => {
      const t = c.add(buffer, { path: options.dir }, (torrent) => resolve(torrent));
      t.on('error', reject);
    });
  } else {
    throw new Error(`Unsupported URL type: ${url.startsWith('http') ? 'HTTP/HTTPS downloads not supported' : 'unknown format'}`);
  }

  const gid = torrent.infoHash;

  if (torrent.private) {
    logger.info('Private torrent — disabling DHT', { gid });
    if (torrent.discovery?.dht) {
      torrent.discovery.dht.destroy();
      torrent.discovery.dht = null;
    }
    setTimeout(() => {
      if (torrent && !torrent.destroyed && torrent.numPeers === 0) {
        logger.warn('Private torrent has 0 peers after 15s', { gid });
      }
    }, 15000);
  }

  if (options.paused) {
    torrent.pause();
    logger.info('Restored torrent in paused state', { gid });
  }

  let lastLoggedPeers = -1;
  const progressInterval = setInterval(() => {
    if (torrent && !torrent.destroyed) {
      const info = formatTorrentInfo(torrent);
      if (torrent.numPeers !== lastLoggedPeers && (torrent.numPeers > 0 || lastLoggedPeers === -1)) {
        logger.debug('Peers update', { gid, peers: torrent.numPeers, progress: Math.round(torrent.progress * 100) });
        lastLoggedPeers = torrent.numPeers;
      }
      writeEvent({ type: 'download-progress', payload: info });
    }
  }, 1000);
  progressIntervals.set(gid, progressInterval);

  downloadMeta.set(gid, {
    url,
    dir: options.dir,
    relativePath: options.relativePath || '',
    addedAt: new Date().toISOString(),
  });

  setupTorrentListeners(torrent, gid, progressInterval);
  await saveDownloadState();

  logger.info('Download added', { gid, name: torrent.name });
  return torrent.infoHash;
}

async function getDownloadStatus(gid) {
  const c = await ensureClient();
  const torrent = c.torrents.find((t) => t.infoHash === gid);
  return torrent ? formatTorrentInfo(torrent) : null;
}

async function getActiveDownloads(filterPath = null) {
  const c = await ensureClient();
  return c.torrents
    .filter((t) => {
      if (t.paused) return false;
      if (filterPath != null) return (downloadMeta.get(t.infoHash)?.relativePath || '') === filterPath;
      return true;
    })
    .map((t) => formatTorrentInfo(t));
}

async function getWaitingDownloads(offset = 0, num = 100, filterPath = null) {
  const c = await ensureClient();

  const webTorrentPaused = c.torrents
    .filter((t) => {
      if (!t.paused) return false;
      if (filterPath != null) return (downloadMeta.get(t.infoHash)?.relativePath || '') === filterPath;
      return true;
    })
    .map((t) => formatTorrentInfo(t));

  let pausedEntries = Array.from(pausedDownloads.values());
  if (filterPath != null) pausedEntries = pausedEntries.filter((d) => (d.path || '') === filterPath);

  return [...webTorrentPaused, ...pausedEntries].slice(offset, offset + num);
}

async function pauseDownload(gid) {
  const c = await ensureClient();
  const torrent = c.torrents.find((t) => t.infoHash === gid);
  if (!torrent) throw new Error(`Download not found: ${gid}`);

  const downloadInfo = formatTorrentInfo(torrent);

  const interval = progressIntervals.get(gid);
  if (interval) { clearInterval(interval); progressIntervals.delete(gid); }

  if (torrent && !torrent.destroyed) {
    try { torrent.removeAllListeners(); } catch {}
  }
  if (client && !torrent.destroyed) {
    client.remove(torrent.infoHash, { destroyStore: false });
  }

  downloadInfo.status = 'paused';
  pausedDownloads.set(gid, downloadInfo);

  writeEvent({ type: 'download-paused', payload: downloadInfo });

  await saveDownloadState();
  logger.info('Download paused', { gid });
  return true;
}

async function resumeDownload(gid) {
  const c = await ensureClient();
  let torrent = c.torrents.find((t) => t.infoHash === gid);

  if (!torrent) {
    const meta = downloadMeta.get(gid);
    if (!meta?.url) throw new Error(`Cannot resume: no metadata for ${gid}`);

    let addTarget = meta.url;
    if (meta.url.startsWith('file://')) {
      addTarget = await readFile(meta.url.slice(7));
    }

    torrent = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Timeout re-adding torrent')), 10000);
      try {
        c.add(addTarget, { path: meta.dir }, (t) => {
          clearTimeout(timeoutId);
          if (!t || t.destroyed) reject(new Error('c.add() returned invalid torrent'));
          else resolve(t);
        });
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  pausedDownloads.delete(gid);

  if (!progressIntervals.has(gid)) {
    let lastLoggedPeers = -1;
    const progressInterval = setInterval(() => {
      if (torrent && !torrent.destroyed) {
        const info = formatTorrentInfo(torrent);
        if (torrent.numPeers !== lastLoggedPeers && (torrent.numPeers > 0 || lastLoggedPeers === -1)) {
          logger.debug('Peers update', { gid, peers: torrent.numPeers });
          lastLoggedPeers = torrent.numPeers;
        }
        writeEvent({ type: 'download-progress', payload: info });
      }
    }, 1000);
    progressIntervals.set(gid, progressInterval);
    setupTorrentListeners(torrent, gid, progressInterval);
  }

  const info = formatTorrentInfo(torrent);
  writeEvent({ type: 'download-resumed', payload: info });

  await saveDownloadState();
  logger.info('Download resumed', { gid });
  return true;
}

async function removeDownload(gid) {
  const c = await ensureClient();
  const torrent = c.torrents.find((t) => t.infoHash === gid);

  if (!torrent) {
    if (pausedDownloads.has(gid)) {
      pausedDownloads.delete(gid);
      downloadMeta.delete(gid);
      await saveDownloadState();
      return true;
    }
    throw new Error(`Download not found: ${gid}`);
  }

  const interval = progressIntervals.get(gid);
  if (interval) { clearInterval(interval); progressIntervals.delete(gid); }

  c.remove(gid);
  downloadMeta.delete(gid);
  await saveDownloadState();

  logger.info('Download removed', { gid });
  return true;
}

// Graceful shutdown
process.on('SIGTERM', () => { if (client) client.destroy(); process.exit(0); });
process.on('SIGINT',  () => { if (client) client.destroy(); process.exit(0); });

// Command dispatch table
const dispatch = {
  addDownload,
  getActiveDownloads,
  getWaitingDownloads,
  pauseDownload,
  resumeDownload,
  removeDownload,
  getDownloadStatus,
  testTrackerConnectivity,
};

// Read commands from parent via stdin
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let id;
  try {
    const { id: cmdId, method, params } = JSON.parse(line);
    id = cmdId;
    if (!dispatch[method]) throw new Error(`Unknown method: ${method}`);
    const result = await dispatch[method](...(params || []));
    writeResponse(id, result);
  } catch (err) {
    writeResponse(id, undefined, err);
  }
});

logger.info('Torrent worker ready, awaiting commands');
