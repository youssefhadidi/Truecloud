/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import fs from 'fs';
import { stat, access, mkdir, writeFile, unlink } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HLS_CACHE_DIR = process.env.HLS_CACHE_DIR || './hls-cache';

const QUALITY_LADDER = [{ label: '1080p', height: 1080, videoBitrate: '5000k', audioBitrate: '96k' }];

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

    ffprobe.on('error', (err) => reject(err));
  });
}

function doubleBitrate(bitrateStr) {
  const match = bitrateStr.match(/^(\d+)([kmg])$/i);
  if (!match) return bitrateStr;
  const value = parseInt(match[1], 10) * 2;
  return `${value}${match[2]}`;
}

// Transcode a single quality
async function transcodeQuality(inputPath, outputDir, quality) {
  const { label, height, videoBitrate, audioBitrate } = quality;
  const qualityDir = join(outputDir, label);

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
      join(qualityDir, 'playlist.m3u8'),
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

// Write master playlist with absolute cache URLs
async function writeMasterPlaylist(cacheDir, sourceWidth, sourceHeight, applicableQualities, pathHash) {
  const masterPath = join(cacheDir, 'master.m3u8');
  let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  for (const quality of applicableQualities) {
    const outputWidth = Math.round(sourceWidth * (quality.height / sourceHeight));
    const evenWidth = outputWidth % 2 === 0 ? outputWidth : outputWidth + 1;

    // Use absolute cache URLs so browser can find segments
    const playlistUrl = `/api/files/hls-cache/${pathHash}/${quality.label}/playlist.m3u8`;

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(quality.videoBitrate) * 1000},RESOLUTION=${evenWidth}x${quality.height},CODECS="avc1.42e01e,mp4a.40.2"\n`;
    content += `${playlistUrl}\n\n`;
  }

  await writeFile(masterPath, content);
}

// Start background transcode
async function startBackgroundTranscode(cacheDir, fullPath, pathHash, applicableQualities) {
  const transcodingPath = join(cacheDir, '.transcoding');
  const failedPath = join(cacheDir, '.failed');

  try {
    logger.info('Background transcode starting', { qualities: applicableQualities.map((q) => q.label) });

    for (const quality of applicableQualities) {
      await transcodeQuality(fullPath, cacheDir, quality);
    }

    logger.info('Background HLS transcode complete');

    try {
      await unlink(transcodingPath);
    } catch {
      // Ignore
    }
  } catch (error) {
    logger.error('Background HLS transcode failed', { error: error.message });

    try {
      await writeFile(failedPath, error.message);
    } catch {
      // Ignore
    }

    try {
      await unlink(transcodingPath);
    } catch {
      // Ignore
    }
  } finally {
    inProgressTranscodes.delete(pathHash);
  }
}

// Ensure master.m3u8 exists and transcode is queued
async function ensureTranscoded(cacheDir, fullPath) {
  const masterPath = join(cacheDir, 'master.m3u8');
  const transcodingPath = join(cacheDir, '.transcoding');
  const failedPath = join(cacheDir, '.failed');

  // Check if already done
  try {
    const [sourceStats, masterStats] = await Promise.all([stat(fullPath), stat(masterPath)]);
    if (masterStats.mtime >= sourceStats.mtime) {
      logger.debug('HLS cache hit');
      return;
    }
  } catch {
    // Master doesn't exist
  }

  // Check if previous transcode failed
  try {
    await access(failedPath);
    throw new Error('Transcoding previously failed. Clear HLS cache to retry.');
  } catch (err) {
    if (err.message.includes('previously failed')) throw err;
  }

  // Check if transcode already in progress
  const pathHash = createHash('md5').update(fullPath).digest('hex');
  if (inProgressTranscodes.has(pathHash)) {
    logger.info('Transcode already in progress');
    return;
  }

  inProgressTranscodes.set(pathHash, true);

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(transcodingPath, '');

    // Probe video
    const { width, height } = await probeVideo(fullPath);
    logger.info('Video probed', { width, height });

    // Determine applicable qualities
    const applicableQualities = QUALITY_LADDER.filter((q) => q.height <= height);
    if (applicableQualities.length === 0) {
      // Source is smaller than all ladder entries — transcode at source resolution
      applicableQualities.push({
        label: `${height}p`,
        height,
        videoBitrate: QUALITY_LADDER[QUALITY_LADDER.length - 1].videoBitrate,
        audioBitrate: QUALITY_LADDER[QUALITY_LADDER.length - 1].audioBitrate,
      });
    }

    // Create directories
    for (const quality of applicableQualities) {
      await mkdir(join(cacheDir, quality.label), { recursive: true });
    }

    // Write master playlist immediately
    await writeMasterPlaylist(cacheDir, width, height, applicableQualities, pathHash);
    logger.info('Master playlist written');

    // Start background transcode (don't await)
    startBackgroundTranscode(cacheDir, fullPath, pathHash, applicableQualities);
  } catch (error) {
    logger.error('HLS setup failed', { error: error.message });
    inProgressTranscodes.delete(pathHash);
    throw error;
  }
}

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/hls - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/hls', { fileId, path: relativePath });

    // Security checks
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Validate extension
    const fileExt = extname(fileId).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(fileExt)) {
      logger.warn('Non-video file requested', { fileExt });
      return NextResponse.json({ error: 'File is not a video' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheBaseDir = resolve(process.cwd(), HLS_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);
    const pathHash = createHash('md5').update(fullPath).digest('hex');
    const cacheDir = join(cacheBaseDir, pathHash);

    // Verify source exists
    try {
      await access(fullPath);
    } catch {
      logger.warn('Source file not found', { fullPath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Ensure transcoding is set up
    await ensureTranscoded(cacheDir, fullPath);

    // Serve master.m3u8
    const masterPath = join(cacheDir, 'master.m3u8');
    const content = await fs.promises.readFile(masterPath, 'utf-8');
    const duration = Date.now() - startTime;
    logger.debug('Serving master.m3u8', { duration: `${duration}ms` });

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('HLS error', { error: error.message, duration: `${duration}ms` });
    return NextResponse.json(
      { error: error.message || 'HLS streaming failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 3600;
export const dynamic = 'force-dynamic';
