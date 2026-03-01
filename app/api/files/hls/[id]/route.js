/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access } from 'fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { getHlsOutputDir } from '@/lib/hlsManager';
import { nodeToWebStream } from '@/lib/streamUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Only allow seg[digits].ts — no path separators, no traversal
const SEGMENT_FILENAME_RE = /^seg\d+\.ts$/;

export async function GET(req, { params }) {
  try {
    const { error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';
    const segment = url.searchParams.get('segment') || null;

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Validate segment filename strictly
    if (segment !== null && !SEGMENT_FILENAME_RE.test(segment)) {
      logger.warn('GET /api/files/hls - Invalid segment filename', { segment });
      return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);

    // Derive the HLS output directory for this file
    const { hlsDir } = getHlsOutputDir(fullPath, cacheDir);

    // Ensure the HLS directory exists
    try {
      await access(hlsDir);
    } catch {
      logger.warn('GET /api/files/hls - HLS directory not found', { hlsDir });
      return NextResponse.json({ error: 'HLS stream not ready' }, { status: 404 });
    }

    if (segment) {
      // Serve a .ts segment with byte-range support
      const segmentPath = join(hlsDir, segment);

      let segmentStat;
      try {
        segmentStat = await stat(segmentPath);
      } catch {
        return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
      }

      const fileSize = segmentStat.size;
      const range = req.headers.get('range');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = Math.min(parts[1] ? parseInt(parts[1], 10) : fileSize - 1, fileSize - 1);
        const chunkSize = end - start + 1;

        return new NextResponse(nodeToWebStream(fs.createReadStream(segmentPath, { start, end, highWaterMark: 256 * 1024 })), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp2t',
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      return new NextResponse(nodeToWebStream(fs.createReadStream(segmentPath, { highWaterMark: 256 * 1024 })), {
        headers: {
          'Content-Type': 'video/mp2t',
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Serve index.m3u8
    const m3u8Path = join(hlsDir, 'index.m3u8');
    try {
      await stat(m3u8Path);
    } catch {
      return NextResponse.json({ error: 'Playlist not ready' }, { status: 404 });
    }

    // Rewrite segment URIs so they point back to this endpoint
    // This is necessary because FFmpeg writes bare "seg000.ts" lines in the manifest,
    // but the browser needs full API URLs with auth.
    const m3u8Raw = await fs.promises.readFile(m3u8Path, 'utf8');
    const baseUrl = `/api/files/hls/${encodeURIComponent(fileId)}?path=${encodeURIComponent(relativePath)}&segment=`;
    const m3u8Rewritten = m3u8Raw.replace(/^(seg\d+\.ts)$/gm, `${baseUrl}$1`);

    return new NextResponse(m3u8Rewritten, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(m3u8Rewritten, 'utf8').toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error('GET /api/files/hls - Error', { error: err.message });
    return NextResponse.json({ error: 'HLS serve failed' }, { status: 500 });
  }
}
