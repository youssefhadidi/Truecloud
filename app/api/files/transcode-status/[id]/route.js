/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { resolve, join, extname } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { readComponentsConfig } from '@/lib/componentsConfig';
import { isCacheReady } from '@/lib/transcodeManager';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';
import {
  isHlsCacheComplete,
  getHlsSegmentCount,
  getHlsJobStatus,
  getHlsHash,
} from '@/lib/hlsManager';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

export async function GET(req, { params }) {
  try {
    const { error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);
    const fileExt = extname(fileId).toLowerCase();

    // All video formats go through HLS
    if (VIDEO_EXTENSIONS_SET.has(fileExt)) {
      const components = await readComponentsConfig();

      if (!components.transcoding) {
        // Transcoding is disabled — tell the player to try as-is
        return NextResponse.json({ status: 'disabled' });
      }

      // 1. Backward compat: existing MP4 cache still wins
      const cachedMp4 = await isCacheReady(fullPath, cacheDir);
      if (cachedMp4) {
        return NextResponse.json({ status: 'ready' });
      }

      // Build the hlsUrl used for early and complete playback
      const params = new URLSearchParams({ path: relativePath });
      const hlsUrl = `/api/files/hls/${encodeURIComponent(fileId)}?${params}`;

      // 2. HLS fully complete (manifest has #EXT-X-ENDLIST)
      const hlsComplete = await isHlsCacheComplete(fullPath, cacheDir);
      if (hlsComplete) {
        return NextResponse.json({ status: 'ready', hlsUrl });
      }

      // 3. HLS has >= 2 segments — start early playback while still transcoding
      const segCount = await getHlsSegmentCount(fullPath, cacheDir);
      if (segCount >= 2) {
        const hash = getHlsHash(fullPath);
        const job = getHlsJobStatus(hash);
        const progress = job.status === 'transcoding' ? job.progress : 99;
        return NextResponse.json({ status: 'transcoding', progress, hlsUrl });
      }

      // 4. In-memory HLS job status
      const hash = getHlsHash(fullPath);
      const job = getHlsJobStatus(hash);

      if (job.status === 'transcoding') {
        return NextResponse.json({ status: 'transcoding', progress: job.progress });
      }

      if (job.status === 'done') {
        return NextResponse.json({ status: 'ready', hlsUrl });
      }

      if (job.status === 'error') {
        return NextResponse.json({ status: 'disabled', reason: 'transcode_failed' });
      }

      // 5. Not started yet
      return NextResponse.json({ status: 'pending' });
    }

    // Unsupported / unknown extension — try native
    return NextResponse.json({ status: 'native' });
  } catch (err) {
    logger.error('GET /api/files/transcode-status - Error', { error: err.message });
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
