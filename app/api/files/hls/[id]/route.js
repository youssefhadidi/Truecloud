/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import fs from 'fs';
import { stat, access, mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HLS_CACHE_DIR = process.env.HLS_CACHE_DIR || './hls-cache';

const QUALITY_LADDER = [
  { label: '1080p', height: 1080, videoBitrate: '5000k', audioBitrate: '192k' },
];

// Track in-progress transcodes to prevent duplicates
const inProgressTranscodes = new Map();

// Probe video dimensions
async function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      filePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('ffprobe failed'));
        return;
      }

      const [width, height] = output.trim().split(',').map(Number);
      if (!width || !height) {
        reject(new Error('Could not determine video dimensions'));
      } else {
        resolve({ width, height });
      }
    });

    ffprobe.on('error', (err) => {
      reject(err);
    });
  });
}

// Helper to double a bitrate string (e.g. "800k" -> "1600k")
function doubleBitrate(bitrateStr) {
  const match = bitrateStr.match(/^(\d+)([kmg])$/i);
  if (!match) return bitrateStr;
  const value = parseInt(match[1], 10) * 2;
  return `${value}${match[2]}`;
}

// Transcode a single quality level
async function transcodeQuality(inputPath, outputDir, quality) {
  const { label, height, videoBitrate, audioBitrate } = quality;
  const qualityDir = join(outputDir, label);
  const playlistPath = join(qualityDir, 'playlist.m3u8');

  // Create quality directory
  await mkdir(qualityDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-vf',
      `scale=-2:${height}`,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-maxrate',
      videoBitrate,
      '-bufsize',
      doubleBitrate(videoBitrate),
      '-c:a',
      'aac',
      '-b:a',
      audioBitrate,
      '-ar',
      '48000',
      '-hls_time',
      '6',
      '-hls_list_size',
      '0',
      '-hls_segment_filename',
      join(qualityDir, 'seg%03d.ts'),
      '-hls_flags',
      'independent_segments',
      '-y',
      playlistPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('HLS transcode complete', { label, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('FFmpeg transcode failed', {
          label,
          code,
          duration: `${duration}ms`,
          errorOutput: errorOutput.slice(-500),
        });
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      logger.error('FFmpeg spawn error', { label, error: err.message });
      reject(err);
    });
  });
}

// Write master playlist
async function writeMasterPlaylist(cacheDir, sourceWidth, sourceHeight, applicableQualities) {
  const masterPath = join(cacheDir, 'master.m3u8');
  let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  for (const quality of applicableQualities) {
    // Calculate actual output width preserving aspect ratio
    const outputWidth = Math.round(sourceWidth * (quality.height / sourceHeight));
    const evenWidth = outputWidth % 2 === 0 ? outputWidth : outputWidth + 1;

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(quality.videoBitrate) * 1000},RESOLUTION=${evenWidth}x${quality.height},CODECS="avc1.42e01e,mp4a.40.2"\n`;
    content += `${quality.label}/playlist.m3u8\n\n`;
  }

  await writeFile(masterPath, content);
}

// Ensure transcoded files exist (returns immediately, transcode happens in background)
async function ensureTranscoded(cacheDir, fullPath) {
  const startTime = Date.now();
  const masterPath = join(cacheDir, 'master.m3u8');
  const transcodingPath = join(cacheDir, '.transcoding');
  const failedPath = join(cacheDir, '.failed');

  // Check if transcode already completed
  try {
    const [sourceStats, masterStats] = await Promise.all([stat(fullPath), stat(masterPath)]);

    // Cache valid if master is newer than source
    if (masterStats.mtime >= sourceStats.mtime) {
      logger.debug('HLS cache hit', { duration: `${Date.now() - startTime}ms` });
      return;
    }
  } catch {
    // Master doesn't exist
  }

  // Check if previous transcode failed
  try {
    await access(failedPath);
    logger.error('HLS transcode previously failed for this file');
    throw new Error('Transcoding previously failed. Try clearing the HLS cache.');
  } catch (err) {
    if (err.message.includes('Transcoding previously failed')) throw err;
    // File doesn't exist, continue
  }

  // Check if transcode is already in progress
  const pathHash = createHash('md5').update(fullPath).digest('hex');
  if (inProgressTranscodes.has(pathHash)) {
    logger.info('HLS transcode already in progress, master playlist already available');
    return;
  }

  // Mark transcode in progress
  inProgressTranscodes.set(pathHash, true);

  try {
    // Create cache directory
    await mkdir(cacheDir, { recursive: true });
    await writeFile(transcodingPath, '');

    logger.info('Starting HLS transcode setup');

    // Probe source video synchronously to determine quality ladder
    const { width, height } = await probeVideo(fullPath);
    logger.info('Video probed', { width, height });

    // Determine applicable quality ladder
    const applicableQualities = QUALITY_LADDER.filter((q) => q.height <= height);
    if (applicableQualities.length === 0) {
      applicableQualities.push(QUALITY_LADDER[0]);
    }

    // Create quality directories and write master playlist immediately
    for (const quality of applicableQualities) {
      const qualityDir = join(cacheDir, quality.label);
      await mkdir(qualityDir, { recursive: true });
    }

    // Write master playlist immediately so user can fetch it
    await writeMasterPlaylist(cacheDir, width, height, applicableQualities);
    logger.info('Master playlist written, segments will be transcoded in background');

    // Start background transcode (don't await)
    startBackgroundTranscode(cacheDir, fullPath, pathHash, applicableQualities);

    const duration = Date.now() - startTime;
    logger.debug('Background transcode queued', { duration: `${duration}ms` });
  } catch (error) {
    logger.error('HLS setup failed', { error: error.message });
    inProgressTranscodes.delete(pathHash);
    throw error;
  }
}

// Background transcode job
async function startBackgroundTranscode(cacheDir, fullPath, pathHash, applicableQualities) {
  const transcodingPath = join(cacheDir, '.transcoding');
  const failedPath = join(cacheDir, '.failed');

  try {
    logger.info('Background transcode starting', { qualities: applicableQualities.map((q) => q.label) });

    // Transcode 1080p in background
    for (const quality of applicableQualities) {
      await transcodeQuality(fullPath, cacheDir, quality);
    }

    logger.info('Background HLS transcode complete');

    // Delete .transcoding sentinel
    try {
      await unlink(transcodingPath);
    } catch {
      // Ignore if already deleted
    }
  } catch (error) {
    logger.error('Background HLS transcode failed', { error: error.message });

    // Write .failed sentinel
    try {
      await writeFile(failedPath, error.message);
    } catch {
      // Ignore
    }

    // Delete .transcoding sentinel
    try {
      await unlink(transcodingPath);
    } catch {
      // Ignore
    }
  } finally {
    inProgressTranscodes.delete(pathHash);
  }
}

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/hls - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    // Get query parameters
    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';
    const type = url.searchParams.get('type') || 'master';
    const quality = url.searchParams.get('quality') || '';
    const seg = url.searchParams.get('seg') || '';

    logger.debug('GET /api/files/hls - Processing', { fileId, path: relativePath, type, quality });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/hls - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Validate file extension
    const fileExt = extname(fileId).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(fileExt)) {
      logger.warn('GET /api/files/hls - Non-video file requested', { fileExt });
      return NextResponse.json({ error: 'File is not a video' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheBaseDir = resolve(process.cwd(), HLS_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);
    const pathHash = createHash('md5').update(fullPath).digest('hex');
    const cacheDir = join(cacheBaseDir, pathHash);

    // Verify source file exists
    try {
      await access(fullPath);
    } catch {
      logger.warn('GET /api/files/hls - Source file not found', { fullPath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Dispatch by type
    if (type === 'master') {
      await ensureTranscoded(cacheDir, fullPath);

      const masterPath = join(cacheDir, 'master.m3u8');
      const content = await readFile(masterPath, 'utf-8');
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/hls - Serving master', { duration: `${duration}ms` });

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (type === 'playlist') {
      if (!quality) {
        logger.error('GET /api/files/hls - playlist type missing quality parameter');
        return NextResponse.json({ error: 'Missing quality parameter' }, { status: 400 });
      }

      const playlistPath = join(cacheDir, quality, 'playlist.m3u8');

      try {
        const content = await readFile(playlistPath, 'utf-8');
        const duration = Date.now() - startTime;
        logger.debug('GET /api/files/hls - Serving playlist', { quality, duration: `${duration}ms` });

        return new NextResponse(content, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache',
          },
        });
      } catch {
        logger.error('GET /api/files/hls - Playlist not found', { playlistPath });
        return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
      }
    }

    if (type === 'segment') {
      if (!quality || !seg) {
        logger.error('GET /api/files/hls - segment type missing parameters');
        return NextResponse.json({ error: 'Missing quality or segment parameter' }, { status: 400 });
      }

      // Validate segment name to prevent path traversal
      if (!/^seg\d{3,6}\.ts$/.test(seg)) {
        logger.error('GET /api/files/hls - Invalid segment name', { seg });
        return NextResponse.json({ error: 'Invalid segment name' }, { status: 400 });
      }

      const segmentPath = join(cacheDir, quality, seg);

      try {
        const data = await readFile(segmentPath);
        const duration = Date.now() - startTime;
        logger.debug('GET /api/files/hls - Serving segment', { quality, seg, duration: `${duration}ms` });

        return new NextResponse(data, {
          headers: {
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      } catch {
        logger.error('GET /api/files/hls - Segment not found', { segmentPath });
        return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
      }
    }

    logger.error('GET /api/files/hls - Invalid type parameter', { type });
    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/hls - Error', { error: error.message, duration: `${duration}ms` });
    return NextResponse.json(
      { error: error.message || 'HLS streaming failed' },
      { status: error.message?.includes('Transcoding previously failed') ? 500 : 500 },
    );
  }
}

export const maxDuration = 3600; // 1 hour for very long videos
export const dynamic = 'force-dynamic';
