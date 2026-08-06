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
import { parseRangeHeader } from '@/lib/httpRange';
import { requireFolderUnlock, extractIncomingPin, findAncestorLockPath, getAllLockedPaths } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Only allow seg[digits].ts — no path separators, no traversal
const SEGMENT_FILENAME_RE = /^seg\d+\.ts$/;

// Wait up to `timeoutMs` for `segmentPath` to exist. Uses fs.watch to get a
// kernel-level wakeup the moment ffmpeg writes the segment (~ms latency)
// instead of polling every 200 ms. Re-stats after each wakeup in case the
// event we would have woken on already fired between two awaits.
async function waitForSegment(hlsDir, segmentPath, timeoutMs, signal) {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  try {
    return await stat(segmentPath);
  } catch {}

  const deadline = Date.now() + timeoutMs;
  // persistent: false so a leaked watcher can never keep the process alive
  const watcher = fs.watch(hlsDir, { persistent: false });

  try {
    while (true) {
      try {
        return await stat(segmentPath);
      } catch {}

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timeout');

      await new Promise((resolveWait, rejectWait) => {
        const done = (err) => {
          watcher.removeListener('change', onChange);
          watcher.removeListener('error', onError);
          signal?.removeEventListener('abort', onAbort);
          clearTimeout(timer);
          err ? rejectWait(err) : resolveWait();
        };
        const onChange = () => done();
        const onError = (err) => done(err);
        const onAbort = () => done(new DOMException('aborted', 'AbortError'));
        const timer = setTimeout(() => done(new Error('timeout')), remaining);

        watcher.on('change', onChange);
        watcher.on('error', onError);
        signal?.addEventListener('abort', onAbort, { once: true });
        // AbortSignal.addEventListener does NOT auto-fire for an already-
        // aborted signal — re-check after registering to close the race where
        // an abort lands between the loop's stat and this listener being armed.
        if (signal?.aborted) done(new DOMException('aborted', 'AbortError'));
      });
    }
  } finally {
    watcher.close();
  }
}

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

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

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
      // Serve a .ts segment with byte-range support.
      // If the segment hasn't been written yet (transcoding in progress), wait up
      // to 30s for FFmpeg to produce it rather than returning a 404 that would
      // stall hls.js when using the pre-written VOD manifest.
      const segmentPath = join(hlsDir, segment);

      let segmentStat;
      try {
        segmentStat = await waitForSegment(hlsDir, segmentPath, 30_000, req.signal);
      } catch (err) {
        if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
        if (err.message === 'timeout') {
          logger.warn('GET /api/files/hls - Segment not ready after 30s', { segment });
          return NextResponse.json({ error: 'Segment not ready' }, { status: 504 });
        }
        throw err;
      }

      const fileSize = segmentStat.size;
      const parsedRange = parseRangeHeader(req.headers.get('range'), fileSize);

      if (parsedRange?.unsatisfiable) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      if (parsedRange) {
        const { start, end } = parsedRange;
        const chunkSize = end - start + 1;

        return new NextResponse(nodeToWebStream(fs.createReadStream(segmentPath, { start, end })), {
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

      return new NextResponse(nodeToWebStream(fs.createReadStream(segmentPath)), {
        headers: {
          'Content-Type': 'video/mp2t',
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Serve the pre-written VOD manifest if available (has correct total duration
    // from the start), otherwise fall back to FFmpeg's growing index.m3u8.
    let m3u8Raw;
    try {
      m3u8Raw = await fs.promises.readFile(join(hlsDir, 'playlist.m3u8'), 'utf8');
    } catch {
      try {
        m3u8Raw = await fs.promises.readFile(join(hlsDir, 'index.m3u8'), 'utf8');
      } catch {
        return NextResponse.json({ error: 'Playlist not ready' }, { status: 404 });
      }
    }

    // Rewrite segment URIs so they point back to this endpoint
    // This is necessary because FFmpeg writes bare "seg000.ts" lines in the manifest,
    // but the browser needs full API URLs with auth.
    //
    // If this manifest request itself carried a folderPin (header, query, or
    // map), the .ts segment URLs need to carry it too — the HLS player fetches
    // segments directly via <video src>/hls.js and won't replay our request
    // headers on each segment.
    let pinSuffix = '';
    {
      const lockedPaths = await getAllLockedPaths();
      const ancestor = findAncestorLockPath(relativePath, lockedPaths);
      if (ancestor) {
        const incomingPin = extractIncomingPin(req, ancestor);
        if (incomingPin) pinSuffix = `&folderPin=${encodeURIComponent(incomingPin)}`;
      }
    }
    const baseUrl = `/api/files/hls/${encodeURIComponent(fileId)}?path=${encodeURIComponent(relativePath)}${pinSuffix}&segment=`;
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
