/** @format */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { resolve, join } from 'node:path';
import { logger } from '@/lib/logger';

const DOWNLOAD_DIR = process.env.ARIA2_DOWNLOAD_DIR || './downloads';
const SESSION_FILE = process.env.ARIA2_SESSION_FILE || './aria2-session.txt';
const STATE_FILE = process.env.ARIA2_STATE_FILE || './aria2-state.json';
const RPC_PORT = process.env.ARIA2_RPC_PORT || 6800;
const RPC_SECRET = process.env.ARIA2_RPC_SECRET || 'truecloud-aria2';

let aria2Process = null;
let isStarting = false;

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
 * Save download state to JSON file for persistence
 */
async function saveDownloadState(downloads) {
  try {
    await writeFile(STATE_FILE, JSON.stringify(downloads, null, 2));
    logger.debug('Download state saved', { count: downloads.length });
  } catch (error) {
    logger.error('Failed to save download state', { error: error.message });
  }
}

/**
 * Load download state from JSON file
 */
async function loadDownloadState() {
  try {
    if (!existsSync(STATE_FILE)) {
      return [];
    }
    const data = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    logger.debug('Download state loaded', { count: state.length });
    return state;
  } catch (error) {
    logger.error('Failed to load download state', { error: error.message });
    return [];
  }
}

/**
 * Start aria2c daemon with RPC
 */
export async function startAria2Daemon() {
  if (aria2Process || isStarting) {
    logger.debug('aria2c daemon already running or starting');
    return true;
  }

  isStarting = true;

  try {
    // Ensure directories exist
    const downloadDir = resolve(process.cwd(), DOWNLOAD_DIR);
    if (!existsSync(downloadDir)) {
      mkdirSync(downloadDir, { recursive: true });
    }

    const sessionFilePath = resolve(process.cwd(), SESSION_FILE);

    // Create session file if it doesn't exist
    if (!existsSync(sessionFilePath)) {
      await writeFile(sessionFilePath, '');
    }

    const args = [
      '--enable-rpc',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${RPC_PORT}`,
      `--rpc-secret=${RPC_SECRET}`,
      '--rpc-allow-origin-all',
      '--continue=true',
      '--max-connection-per-server=8',
      '--split=8',
      '--min-split-size=1M',
      '--max-concurrent-downloads=5',
      '--allow-overwrite=false',
      '--auto-file-renaming=true',
      `--dir=${downloadDir}`,
      `--input-file=${sessionFilePath}`,
      `--save-session=${sessionFilePath}`,
      '--save-session-interval=60',
      '--force-save=true',
      '--daemon=false',
      '--quiet=false',
    ];

    aria2Process = spawn('aria2c', args);

    aria2Process.stdout?.on('data', (data) => {
      logger.debug('aria2c stdout', { output: data.toString().substring(0, 200) });
    });

    aria2Process.stderr?.on('data', (data) => {
      logger.warn('aria2c stderr', { output: data.toString().substring(0, 200) });
    });

    aria2Process.on('close', (code) => {
      logger.info('aria2c daemon stopped', { code });
      aria2Process = null;
    });

    aria2Process.on('error', (err) => {
      logger.error('aria2c daemon error', { error: err.message });
      aria2Process = null;
      isStarting = false;
    });

    // Wait a bit for daemon to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    isStarting = false;
    logger.info('aria2c daemon started', { port: RPC_PORT });
    return true;
  } catch (error) {
    isStarting = false;
    logger.error('Failed to start aria2c daemon', { error: error.message });
    return false;
  }
}

/**
 * Stop aria2c daemon
 */
export async function stopAria2Daemon() {
  if (!aria2Process) {
    return;
  }

  try {
    const response = await callAria2RPC('aria2.shutdown', []);
    logger.info('aria2c daemon shutdown requested');
    aria2Process = null;
  } catch (error) {
    logger.warn('Failed to shutdown aria2c daemon gracefully', { error: error.message });
    if (aria2Process) {
      aria2Process.kill();
      aria2Process = null;
    }
  }
}

/**
 * Call aria2 RPC method
 */
async function callAria2RPC(method, params = []) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now().toString(),
    method,
    params: [`token:${RPC_SECRET}`, ...params],
  };

  const response = await fetch(`http://localhost:${RPC_PORT}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`RPC call failed: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
}

/**
 * Add a new download (HTTP, HTTPS, FTP, or torrent/magnet)
 */
export async function addDownload(url, options = {}) {
  await ensureDaemonRunning();

  try {
    let gid;

    // Check if it's a torrent file path or magnet link
    if (url.startsWith('magnet:') || url.endsWith('.torrent')) {
      // Add torrent/magnet
      gid = await callAria2RPC('aria2.addTorrent', [
        url.startsWith('magnet:') ? url : '', // magnet link
        url.endsWith('.torrent') && !url.startsWith('magnet:') ? [url] : [], // torrent file URIs
        options,
      ]);
    } else {
      // Add HTTP/HTTPS/FTP download
      gid = await callAria2RPC('aria2.addUri', [[url], options]);
    }

    logger.info('Download added', { gid, url });
    return gid;
  } catch (error) {
    logger.error('Failed to add download', { error: error.message, url });
    throw error;
  }
}

/**
 * Get download status
 */
export async function getDownloadStatus(gid) {
  await ensureDaemonRunning();

  try {
    const result = await callAria2RPC('aria2.tellStatus', [
      gid,
      ['gid', 'totalLength', 'completedLength', 'downloadSpeed', 'status', 'files', 'errorMessage'],
    ]);

    return formatDownloadInfo(result);
  } catch (error) {
    logger.warn('Failed to get download status', { error: error.message, gid });
    return null;
  }
}

/**
 * Get all active downloads
 */
export async function getActiveDownloads() {
  await ensureDaemonRunning();

  try {
    const results = await callAria2RPC('aria2.tellActive', [
      ['gid', 'totalLength', 'completedLength', 'downloadSpeed', 'status', 'files', 'errorMessage'],
    ]);

    return results.map(formatDownloadInfo);
  } catch (error) {
    logger.warn('Failed to get active downloads', { error: error.message });
    return [];
  }
}

/**
 * Get all stopped downloads
 */
export async function getStoppedDownloads(offset = 0, num = 100) {
  await ensureDaemonRunning();

  try {
    const results = await callAria2RPC('aria2.tellStopped', [
      offset,
      num,
      ['gid', 'totalLength', 'completedLength', 'downloadSpeed', 'status', 'files', 'errorMessage'],
    ]);

    return results.map(formatDownloadInfo);
  } catch (error) {
    logger.warn('Failed to get stopped downloads', { error: error.message });
    return [];
  }
}

/**
 * Remove a download
 */
export async function removeDownload(gid) {
  await ensureDaemonRunning();

  try {
    await callAria2RPC('aria2.remove', [gid]);
    logger.info('Download removed', { gid });
    return true;
  } catch (error) {
    // Try force remove
    try {
      await callAria2RPC('aria2.forceRemove', [gid]);
      logger.info('Download force removed', { gid });
      return true;
    } catch (forceError) {
      logger.error('Failed to remove download', { error: error.message, gid });
      throw error;
    }
  }
}

/**
 * Pause a download
 */
export async function pauseDownload(gid) {
  await ensureDaemonRunning();

  try {
    await callAria2RPC('aria2.pause', [gid]);
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
  await ensureDaemonRunning();

  try {
    await callAria2RPC('aria2.unpause', [gid]);
    logger.info('Download resumed', { gid });
    return true;
  } catch (error) {
    logger.error('Failed to resume download', { error: error.message, gid });
    throw error;
  }
}

/**
 * Ensure aria2c daemon is running
 */
async function ensureDaemonRunning() {
  if (!aria2Process && !isStarting) {
    await startAria2Daemon();
  }

  // Wait for daemon to be ready
  let attempts = 0;
  while ((aria2Process || isStarting) && attempts < 10) {
    try {
      await callAria2RPC('aria2.getVersion', []);
      return;
    } catch (error) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (attempts >= 10) {
    throw new Error('aria2c daemon not responding');
  }
}

/**
 * Format download info from aria2c response
 */
function formatDownloadInfo(result) {
  const totalLength = parseInt(result.totalLength || 0);
  const completedLength = parseInt(result.completedLength || 0);
  const downloadSpeed = parseInt(result.downloadSpeed || 0);

  let name = 'Unknown';
  if (result.files && result.files.length > 0) {
    const filePath = result.files[0].path;
    if (filePath) {
      name = filePath.split('/').pop() || filePath.split('\\').pop() || 'Unknown';
    }
  }

  return {
    gid: result.gid,
    name,
    status: result.status,
    progress: totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0,
    speed: formatBytes(downloadSpeed) + '/s',
    downloaded: formatBytes(completedLength),
    totalSize: formatBytes(totalLength),
    error: result.errorMessage || null,
  };
}

// Start daemon on module load
startAria2Daemon().catch((err) => {
  logger.error('Failed to start aria2c daemon on module load', { error: err.message });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down aria2c daemon');
  await stopAria2Daemon();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down aria2c daemon');
  await stopAria2Daemon();
  process.exit(0);
});
