/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { resolve, join, extname } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { readComponentsConfig } from '@/lib/componentsConfig';
import {
  TRANSCODE_EXTENSIONS,
  isCacheReady,
  getJobStatus,
  getFileHash,
} from '@/lib/transcodeManager';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Extensions that browsers can play natively without any processing
const NATIVE_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.ogg']);

// Extensions that are already handled by the stream route's existing remux logic
const MKV_EXTENSIONS = new Set(['.mkv']);

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

    // Native formats — play directly, no processing needed
    if (NATIVE_EXTENSIONS.has(fileExt)) {
      return NextResponse.json({ status: 'native' });
    }

    // MKV — handled by stream route's existing remux logic
    // Report ready if cache exists, pending otherwise (stream route will trigger remux)
    if (MKV_EXTENSIONS.has(fileExt)) {
      const cachedMp4 = await isCacheReady(fullPath, cacheDir);
      return NextResponse.json({ status: cachedMp4 ? 'ready' : 'pending' });
    }

    // Other formats that need transcoding
    if (TRANSCODE_EXTENSIONS.has(fileExt)) {
      const components = await readComponentsConfig();

      if (!components.transcoding) {
        // Transcoding is disabled — tell the player to try as-is
        return NextResponse.json({ status: 'disabled' });
      }

      // Check if a ready cache exists
      const cachedMp4 = await isCacheReady(fullPath, cacheDir);
      if (cachedMp4) {
        return NextResponse.json({ status: 'ready' });
      }

      // Check in-progress job
      const hash = getFileHash(fullPath);
      const job = getJobStatus(hash);

      if (job.status === 'transcoding') {
        return NextResponse.json({ status: 'transcoding', progress: job.progress });
      }

      if (job.status === 'done') {
        return NextResponse.json({ status: 'ready' });
      }

      if (job.status === 'error') {
        // Job failed — let the player try the original (may not play)
        return NextResponse.json({ status: 'disabled', reason: 'transcode_failed' });
      }

      // Not started yet
      return NextResponse.json({ status: 'pending' });
    }

    // Unsupported / unknown extension — try native
    return NextResponse.json({ status: 'native' });
  } catch (err) {
    logger.error('GET /api/files/transcode-status - Error', { error: err.message });
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
