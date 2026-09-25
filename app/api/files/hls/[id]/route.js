/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access } from 'fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { getHlsOutputDir, requestHlsSegment, touchHlsJob } from '@/lib/hlsManager';
import { normalizeTranscodingConfig } from '@/lib/transcodingConfig';
import { nodeToWebStream } from '@/lib/streamUtils';
import { parseRangeHeader, buildValidators, evaluateConditional } from '@/lib/httpRange';
import { requireFolderUnlock, extractIncomingPin, findAncestorLockPath, getAllLockedPaths } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Only allow segN.ts / segN.m4s / init.mp4 — no path separators, no traversal
const SEGMENT_FILENAME_RE = /^(?:seg\d+\.(?:ts|m4s)|init\.mp4)$/;

// MPEG-TS for the H.264 rendition; fragmented MP4 for HEVC copies.
function segmentContentType(name) {
  if (name.endsWith('.ts')) return 'video/mp2t';
  if (name.endsWith('.m4s')) return 'video/iso.segment';
  return 'video/mp4';
}

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
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';
    const segment = url.searchParams.get('segment') || null;
    // Which rendition (see chooseHlsVariant). Anything unrecognised is the
    // default, so a tampered value can only select a directory that exists
    // for this file anyway.
    const variant = url.searchParams.get('r') === 'hevc' ? 'hevc' : 'h264';
    // The maxHeight the viewer's rendition was started with (absent = source
    // height). Normalised to a valid preset, so like `r` it can only select
    // another rendition of this same file.
    const { maxHeight } = normalizeTranscodingConfig({ maxHeight: url.searchParams.get('mh') });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Validate segment filename strictly
    if (segment !== null && !SEGMENT_FILENAME_RE.test(segment)) {
      logger.warn('GET /api/files/hls - Invalid segment filename', { segment });
      return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
    }

    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });
    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/hls - Access denied', { fileId, relativePath, userId: session.user.id });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }
    relativePath = accessCheck.normalizedPath;

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);

    // Derive the HLS output directory for this version of the file
    let hash, hlsDir;
    try {
      ({ hash, hlsDir } = await getHlsOutputDir(fullPath, cacheDir, { variant, maxHeight }));
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Someone is watching: keeps a running transcode from being stopped as
    // idle while another video waits for the encoder.
    touchHlsJob(hash);

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

      let segmentStat = await stat(segmentPath).catch(() => null);
      if (!segmentStat) {
        // Not written yet. If it is far ahead of the encoder (the viewer
        // seeked), this restarts ffmpeg at it rather than leaving the request
        // to wait for an encode that will not get there within 30 s.
        const index = /^seg(\d+)\./.exec(segment);
        if (index) requestHlsSegment(hash, parseInt(index[1], 10));
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
      }

      const fileSize = segmentStat.size;
      let parsedRange = parseRangeHeader(req.headers.get('range'), fileSize);

      // Segment URLs carry `v`, the rendition hash, which covers the file
      // version, variant, maxHeight and encode args — anything that changes a
      // segment's content changes its URL, so the browser may keep it for good.
      // Only when `v` is this rendition, though: a URL from a manifest handed
      // out before the file was replaced now resolves to the new rendition, and
      // must not pin its segments under the old name. Validators cover the rest.
      const validators = buildValidators(segmentStat);
      const cacheHeaders = {
        ETag: validators.etag,
        'Last-Modified': validators.lastModified,
        'Cache-Control': url.searchParams.get('v') === hash ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      };
      const conditional = evaluateConditional(req, validators, !!parsedRange);
      if (conditional.notModified) {
        return new NextResponse(null, { status: 304, headers: cacheHeaders });
      }
      if (conditional.ignoreRange) parsedRange = null;

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
            'Content-Type': segmentContentType(segment),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            ...cacheHeaders,
          },
        });
      }

      return new NextResponse(nodeToWebStream(fs.createReadStream(segmentPath)), {
        headers: {
          'Content-Type': segmentContentType(segment),
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          ...cacheHeaders,
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

    // Cache dirs written before -hls_playlist_type=event shipped still have a
    // bare in-progress manifest, which hls.js reads as LIVE and drives back to
    // seg000 forever (see buildHlsArgs). Declare EVENT for them too so existing
    // caches don't have to be wiped. Safe by construction: -hls_list_size 0
    // means segments are only ever appended, which is what EVENT asserts.
    if (!m3u8Raw.includes('#EXT-X-PLAYLIST-TYPE') && !m3u8Raw.includes('#EXT-X-ENDLIST')) {
      m3u8Raw = m3u8Raw.replace(/^#EXTM3U[^\n]*\n/, (line) => `${line}#EXT-X-PLAYLIST-TYPE:EVENT\n`);
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
    // `v` names this rendition, so segment URLs change when the file is
    // replaced and the browser's copies of the old ones go unused.
    const variantSuffix = variant === 'h264' ? '' : `&r=${variant}`;
    const maxHeightSuffix = maxHeight == null ? '' : `&mh=${maxHeight}`;
    const baseUrl = `/api/files/hls/${encodeURIComponent(fileId)}?path=${encodeURIComponent(relativePath)}${pinSuffix}${variantSuffix}${maxHeightSuffix}&v=${hash}&segment=`;
    const m3u8Rewritten = m3u8Raw
      .replace(/^(seg\d+\.(?:ts|m4s))$/gm, `${baseUrl}$1`)
      // fMP4 renditions name their init segment in a tag, not on a line of its own.
      .replace(/^#EXT-X-MAP:URI="(init\.mp4)"/m, `#EXT-X-MAP:URI="${baseUrl}$1"`);

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
