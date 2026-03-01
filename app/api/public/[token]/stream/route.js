/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import fs from 'fs';
import { stat, access, mkdir, rename } from 'fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import mime from 'mime-types';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import {
  checkMoovAtom,
  fixMp4ForStreaming,
  remuxMkvToMp4,
} from '@/lib/ffmpegUtils';
import { nodeToWebStream } from '@/lib/streamUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// Track in-progress MP4 fixes to deduplicate concurrent public requests
const inProgressFixes = new Map();

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    // Accept password from header or query param (for video/audio tags that can't send headers)
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Get optional subpath for directory shares
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

    // Build the path to the file
    let pathCheck;
    if (share.isDirectory && subPath) {
      pathCheck = validateSharePath(share, subPath);
    } else if (share.isDirectory && fileName !== share.fileName) {
      // For directory shares, file parameter specifies which file
      pathCheck = validateSharePath(share, fileName);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);
    const resolvedPath = resolve(filePath) + sep;

    // Security: prevent directory traversal
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Verify file exists
    try {
      await access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    let streamPath = filePath;
    const fileExt = extname(filePath).toLowerCase();

    // Check if it's an MP4 that might need fixing for streaming
    if (fileExt === '.mp4') {
      const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
      const pathHash = createHash('md5').update(filePath).digest('hex');
      const cachedPath = join(cacheDir, `${pathHash}.mp4`);

      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(filePath), stat(cachedPath)]);

        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
        }
      } catch {
        // Cache doesn't exist
      }

      if (!useCache) {
        const hasMoovAtStart = await checkMoovAtom(filePath);

        if (!hasMoovAtStart) {
          await mkdir(cacheDir, { recursive: true });

          try {
            await fixMp4ForStreaming(filePath, cachedPath);
            streamPath = cachedPath;
          } catch (err) {
            // Fall back to original file
          }
        }
      }
    }

    // MKV files need remuxing to MP4 for browser playback (audio codec compatibility)
    if (fileExt === '.mkv') {
      const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
      const pathHash = createHash('md5').update(filePath).digest('hex');
      const cachedPath = join(cacheDir, `${pathHash}.mp4`);

      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(filePath), stat(cachedPath)]);
        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
        }
      } catch {
        // Cache doesn't exist
      }

      if (!useCache) {
        await mkdir(cacheDir, { recursive: true });

        try {
          const tmpPath = cachedPath + '.tmp';
          await remuxMkvToMp4(filePath, tmpPath);
          await rename(tmpPath, cachedPath);
          streamPath = cachedPath;
        } catch (err) {
          // Fall back to original MKV
        }
      }
    }

    const fileStats = await stat(streamPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(streamPath) || 'application/octet-stream';

    // Parse range header
    const range = req.headers.get('range');

    if (!range) {
      return new NextResponse(
        nodeToWebStream(fs.createReadStream(streamPath)),
        {
          headers: {
            'Content-Type': mimeType,
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
          },
        }
      );
    }

    // Parse range
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    return new NextResponse(
      nodeToWebStream(fs.createReadStream(streamPath, { start, end })),
      {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': mimeType,
        },
      }
    );
  } catch (error) {
    logger.error('GET /api/public/[token]/stream - Error', { error: error.message });
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
  }
}
