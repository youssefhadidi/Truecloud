/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'node:path';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { logger } from '@/lib/logger';

const TORRENT_FILE_DIR = process.env.TORRENT_FILE_DIR || './torrents';
const TORRENT_DOWNLOAD_DIR = process.env.TORRENT_DOWNLOAD_DIR || './downloads';

// In-memory store for active downloads (in production, use Redis or database)
const activeDownloads = new Map();

/**
 * Start an aria2c download and track progress
 */
async function startAria2cDownload(torrentPath, magnetLink = null) {
  return new Promise((resolve, reject) => {
    const downloadId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const args = [
      '--enable-rpc',
      '--rpc-listen-all=false',
      '--rpc-listen-port=6800',
      '--max-connection-per-server=5',
      '--split=5',
      '--min-split-size=1M',
      '--allow-overwrite=false',
      `--dir=${resolve(process.cwd(), TORRENT_DOWNLOAD_DIR)}`,
    ];

    if (magnetLink) {
      args.push(magnetLink);
    } else {
      args.push(torrentPath);
    }

    const aria2c = spawn('aria2c', args);
    let errorOutput = '';
    let stdoutOutput = '';

    aria2c.stdout.on('data', (data) => {
      stdoutOutput += data.toString();
      logger.debug('aria2c stdout', { output: data.toString().substring(0, 200) });
    });

    aria2c.stderr.on('data', (data) => {
      errorOutput += data.toString();
      logger.debug('aria2c stderr', { output: data.toString().substring(0, 200) });
    });

    aria2c.on('close', (code) => {
      if (code === 0) {
        logger.info('aria2c download started', { downloadId, torrentPath, magnetLink: !!magnetLink });
        resolve({
          gid: downloadId,
          name: magnetLink ? 'Magnet Download' : torrentPath.split('/').pop(),
          status: 'active',
          progress: 0,
          speed: '0 B/s',
          downloaded: '0 B',
          totalSize: 'Unknown',
        });
      } else {
        logger.error('aria2c failed', { code, error: errorOutput.substring(0, 200) });
        reject(new Error(`aria2c exited with code ${code}: ${errorOutput.substring(0, 200)}`));
      }
    });

    aria2c.on('error', (err) => {
      logger.error('aria2c spawn error', { error: err.message });
      reject(new Error(`Failed to start aria2c: ${err.message}`));
    });
  });
}

/**
 * Get download progress from aria2c RPC
 */
async function getDownloadProgress(gid) {
  try {
    const response = await fetch('http://localhost:6800/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'aria2.tellStatus',
        params: [gid],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.error) {
      logger.warn('aria2c RPC error', { error: data.error });
      return null;
    }

    const result = data.result;
    const totalLength = parseInt(result.totalLength || 0);
    const completedLength = parseInt(result.completedLength || 0);
    const downloadSpeed = parseInt(result.downloadSpeed || 0);

    return {
      gid,
      name: result.files?.[0]?.path?.split('/').pop() || 'Unknown',
      status: result.status,
      progress: totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0,
      speed: formatBytes(downloadSpeed) + '/s',
      downloaded: formatBytes(completedLength),
      totalSize: formatBytes(totalLength),
    };
  } catch (error) {
    logger.warn('Failed to get download progress', { error: error.message });
    return null;
  }
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * POST /api/files/torrent-download
 * Start a new torrent download
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
    const magnetLink = formData.get('magnetLink');

    if (!torrentFile && !magnetLink) {
      return NextResponse.json({ error: 'Please provide either a torrent file or magnet link' }, { status: 400 });
    }

    // Ensure download directory exists
    const downloadDir = resolve(process.cwd(), TORRENT_DOWNLOAD_DIR);
    if (!existsSync(downloadDir)) {
      mkdirSync(downloadDir, { recursive: true });
    }

    let downloadInfo;

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

      // Start download with torrent file
      downloadInfo = await startAria2cDownload(torrentPath);
    } else {
      // Start download with magnet link
      downloadInfo = await startAria2cDownload(null, magnetLink);
    }

    logger.info('POST /api/files/torrent-download - Download started', { gid: downloadInfo.gid });
    return NextResponse.json(downloadInfo);
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('POST /api/files/torrent-download - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * GET /api/files/torrent-downloads
 * Get list of active downloads with progress
 */
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/torrent-downloads - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      // Get list of downloads from aria2c
      const response = await fetch('http://localhost:6800/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'aria2.tellActive',
          params: [['gid', 'totalLength', 'completedLength', 'downloadSpeed', 'status', 'files']],
        }),
      });

      if (!response.ok) {
        logger.warn('GET /api/files/torrent-downloads - aria2c RPC unavailable');
        return NextResponse.json({ downloads: [] });
      }

      const data = await response.json();

      if (data.error) {
        logger.warn('GET /api/files/torrent-downloads - aria2c RPC error', { error: data.error });
        return NextResponse.json({ downloads: [] });
      }

      const downloads = (data.result || []).map((result) => {
        const totalLength = parseInt(result.totalLength || 0);
        const completedLength = parseInt(result.completedLength || 0);
        const downloadSpeed = parseInt(result.downloadSpeed || 0);

        return {
          gid: result.gid,
          name: result.files?.[0]?.path?.split('/').pop() || 'Unknown',
          status: result.status,
          progress: totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0,
          speed: formatBytes(downloadSpeed) + '/s',
          downloaded: formatBytes(completedLength),
          totalSize: formatBytes(totalLength),
        };
      });

      logger.debug('GET /api/files/torrent-downloads - Success', { count: downloads.length });
      return NextResponse.json({ downloads });
    } catch (error) {
      // aria2c daemon not running or not available
      logger.warn('GET /api/files/torrent-downloads - aria2c unavailable', { error: error.message });
      return NextResponse.json({ downloads: [] });
    }
  } catch (error) {
    const errorMessage = error.message || 'Internal Server Error';
    logger.error('GET /api/files/torrent-downloads - Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
