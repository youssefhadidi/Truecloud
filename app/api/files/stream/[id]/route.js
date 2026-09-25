/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import fs from 'fs';
import { stat, access, lstat, realpath } from 'fs/promises';
import { join, resolve, extname } from 'node:path';
import mime from 'mime-types';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { isNativelyPlayable } from '@/lib/ffmpegUtils';
import { getProbeInfo, peekProbeInfo } from '@/lib/probeCache';
import { nodeToWebStream } from '@/lib/streamUtils';
import { parseRangeHeader, buildValidators, evaluateConditional } from '@/lib/httpRange';
import { readComponentsConfig } from '@/lib/componentsConfig';
import { readTranscodingConfig } from '@/lib/transcodingConfig';
import { startHlsJob } from '@/lib/hlsManager';
import { chooseHlsVariant, parseHevcSupport } from '@/lib/hlsEncode.mjs';
import { Semaphore } from '@/lib/semaphore.mjs';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';
import { requireFolderUnlock, extractIncomingPin, findAncestorLockPath, getAllLockedPaths } from '@/lib/folderLocks';

// Re-extract the PIN from the request and format it as a URL suffix to
// append to the hlsUrl we return. The browser will hit /api/files/hls
// directly (via hls.js / <video src>) so the PIN must travel in the URL.
async function buildHlsPinSuffix(req, relativePath) {
  const lockedPaths = await getAllLockedPaths();
  const ancestor = findAncestorLockPath(relativePath, lockedPaths);
  if (!ancestor) return '';
  const pin = extractIncomingPin(req, ancestor);
  return pin ? `&folderPin=${encodeURIComponent(pin)}` : '';
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Limit concurrent ffprobe invocations. Each probe spawns 2 processes (codecs +
// duration) each holding 3 pipe FDs. Without a cap, rapid media viewer scrolling
// exhausts the OS FD limit and causes ECONNREFUSED for every subsequent request.
const probeSemaphore = new Semaphore(3);

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

// Read size for serving file bytes. Every chunk is a pull through the Web
// stream wrapper and a trip through the event loop; the 64 KB default costs
// ~190 of them per second for a 100 Mbit/s 4K remux, per viewer, against ~12
// at 1 MB. The stream is pull-based
// (see nodeToWebStream), so this is also roughly the memory each open stream
// holds — 1 MB is fine for a handful of viewers.
const STREAM_CHUNK_BYTES = 1024 * 1024;

export async function GET(req, { params }) {
  const startTime = Date.now();
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/stream - Processing', { fileId, path: relativePath });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/stream - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });
    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/stream - Access denied', { fileId, relativePath, userId: session.user.id });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }
    relativePath = accessCheck.normalizedPath;

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);

    // Verify file exists
    try {
      await access(fullPath);
    } catch {
      logger.warn('GET /api/files/stream - File not found', { fullPath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Debug: Check if file is a symlink
    try {
      const linkStats = await lstat(fullPath);
      logger.debug('GET /api/files/stream - File symlink check', {
        fullPath,
        isSymlink: linkStats.isSymbolicLink(),
        lstatSize: linkStats.size
      });

      if (linkStats.isSymbolicLink()) {
        const realPath = await realpath(fullPath);
        const realStats = await stat(realPath);
        logger.info('GET /api/files/stream - File is a symlink', {
          originalPath: fullPath,
          realPath,
          lstatSize: linkStats.size,
          realstatSize: realStats.size
        });
      }
    } catch (err) {
      logger.warn('GET /api/files/stream - Error checking symlink', {
        fullPath,
        error: err.message
      });
    }

    const fileExt = extname(fileId).toLowerCase();

    // On-demand HLS transcoding for all video formats
    if (VIDEO_EXTENSIONS_SET.has(fileExt)) {
      const components = await readComponentsConfig();

      if (components.transcoding) {
        // Fast path: a probe from a previous request already says this file
        // plays as-is. peekProbeInfo never spawns anything — on a hit this
        // costs one stat.
        const cachedProbe = await peekProbeInfo(fullPath);
        if (cachedProbe && isNativelyPlayable(fileExt, cachedProbe)) {
          logger.debug('GET /api/files/stream - Natively playable (cached probe), serving directly', {
            fileId,
          });
        } else {
          // Short-circuit if the client already navigated away before we start
          // the expensive ffprobe work — prevents FD exhaustion from rapid scrolling.
          if (req.signal?.aborted) {
            return new NextResponse(null, { status: 499 });
          }

          // Start HLS job in background (non-blocking)
          // Debug: Log file stats and probing info
          logger.info('GET /api/files/stream - Before HLS probing', {
            fullPath,
            fileId,
            fileExists: true,
            uploadDir: UPLOAD_DIR,
            relativePath
          });

          // Hardware transcoding is explicitly enabled in admin — use VAAPI.
          // HWACCEL=none env var is the only escape hatch to force software encoding.
          const hwaccel = process.env.HWACCEL?.toLowerCase() === 'none' ? 'none' : 'vaapi';

          // Acquire the probe semaphore: at most 3 concurrent ffprobe pairs can run
          // at the same time. Requests beyond that wait in queue rather than spawning
          // unlimited subprocesses. Pass req.signal so waiting requests are cancelled
          // immediately if the client disconnects while queued.
          try {
            await probeSemaphore.acquire(1, req.signal);
          } catch (err) {
            if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
            throw err;
          }
          let probe, transcodingConfig;
          try {
            // Check again after waiting for the semaphore — client may have left
            if (req.signal?.aborted) {
              return new NextResponse(null, { status: 499 });
            }

            // One cached probe covers codecs, resolution, pixel format and
            // duration — and it is the same entry the status route just
            // populated, so on the normal open path this spawns nothing.
            [probe, transcodingConfig] = await Promise.all([
              getProbeInfo(fullPath, req.signal),
              readTranscodingConfig(),
            ]);
          } catch (err) {
            if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
            throw err;
          } finally {
            probeSemaphore.release();
          }

          // If the client disconnected while we were probing, don't start ffmpeg
          if (req.signal?.aborted) {
            return new NextResponse(null, { status: 499 });
          }

          const durationSecs = probe.durationSecs;

          logger.info('GET /api/files/stream - Probing complete', {
            fullPath,
            videoCodec: probe.videoCodec,
            audioCodec: probe.audioCodec,
            videoHeight: probe.videoHeight,
            pixFmt: probe.pixFmt,
            hwaccel,
            durationSecs,
            maxHeight: transcodingConfig.maxHeight ?? 'original',
          });

          // Container + codecs the browser decodes on its own → serve the
          // bytes directly, no HLS.
          if (isNativelyPlayable(fileExt, probe)) {
            logger.info('GET /api/files/stream - Native video detected, serving directly', { fileId, ext: fileExt });
            // Fall through to byte-range serving
          } else {
            // Copy HEVC as-is when this viewer's browser reported it can decode it.
            const variant = chooseHlsVariant(probe, {
              hevcSupport: parseHevcSupport(url.searchParams.get('hevc')),
              maxHeight: transcodingConfig.maxHeight,
            });
            const job = await startHlsJob(fullPath, cacheDir, probe, hwaccel, durationSecs, {
              maxHeight: transcodingConfig.maxHeight,
              variant,
            });

            if (job.status === 'transcoding') {
              logger.info('GET /api/files/stream - HLS transcoding in progress', {
                fileId,
                progress: job.progress,
                queuePosition: job.queuePosition ?? 0,
              });
              return NextResponse.json(
                {
                  error: 'Video is being transcoded for playback. Please try again shortly.',
                  status: 'transcoding',
                  progress: job.progress,
                  queuePosition: job.queuePosition ?? 0,
                },
                { status: 202 },
              );
            }

            if (job.status === 'done') {
              const hlsParams = new URLSearchParams({ path: relativePath });
              if (variant !== 'h264') hlsParams.set('r', variant);
              // The rendition is keyed on maxHeight too; pin the one this
              // viewer started on, so an admin changing it mid-film doesn't
              // move the HLS route to a directory that isn't encoded yet.
              if (transcodingConfig.maxHeight != null) hlsParams.set('mh', String(transcodingConfig.maxHeight));
              // Carry the folder PIN forward — the browser will fetch this
              // manifest URL directly via hls.js / <video src> and can't
              // attach the X-Folder-Pins header on its own.
              const hlsPinSuffix = await buildHlsPinSuffix(req, relativePath);
              const hlsUrl = `/api/files/hls/${encodeURIComponent(fileId)}?${hlsParams}${hlsPinSuffix}`;
              logger.info('GET /api/files/stream - HLS ready, returning hlsUrl', { fileId });
              return NextResponse.json({ status: 'ready', hlsUrl });
            }

            if (job.status === 'error') {
              logger.warn('GET /api/files/stream - HLS transcode failed, serving original', { fileId });
              // Fall through to serve original file as best-effort
            }
          }
        }
      }
      // If transcoding disabled: fall through and serve the original file as-is
    }

    const fileStats = await stat(fullPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

    // Validators describe the bytes being served, which are always the original file.
    const validators = buildValidators(fileStats);
    // Let the browser reuse what it has already downloaded (a backward seek is
    // otherwise a full re-fetch), but revalidate hourly so a replaced file is
    // picked up without the viewer having to hard-refresh. `private` because
    // these bytes are behind a per-user auth check and must not land in a
    // shared proxy cache.
    const cacheHeaders = {
      ETag: validators.etag,
      'Last-Modified': validators.lastModified,
      'Cache-Control': 'private, max-age=3600',
    };

    // Parse range header. Handles suffix ranges (`bytes=-N`), which browsers use
    // to locate the `moov` atom of a non-faststart MP4 — see lib/httpRange.js.
    let parsedRange = parseRangeHeader(req.headers.get('range'), fileSize);

    const conditional = evaluateConditional(req, validators, !!parsedRange);
    if (conditional.notModified) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }
    // If-Range didn't match: the file changed under the client, so give it the
    // whole current entity instead of a range spliced into a stale buffer.
    if (conditional.ignoreRange) parsedRange = null;

    if (parsedRange?.unsatisfiable) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      });
    }

    if (!parsedRange) {
      // No range (or one we don't honour), send entire file
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/stream - Streaming full file', { fileId, duration: `${duration}ms` });
      return new NextResponse(nodeToWebStream(fs.createReadStream(fullPath, { highWaterMark: STREAM_CHUNK_BYTES })), {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          ...cacheHeaders,
        },
      });
    }

    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;

    // Stream file chunk
    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/stream - Streaming range', {
      fileId,
      range: `${start}-${end}/${fileSize}`,
      chunkSize,
      duration: `${duration}ms`,
    });

    return new NextResponse(nodeToWebStream(fs.createReadStream(fullPath, { start, end, highWaterMark: STREAM_CHUNK_BYTES })), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mimeType,
        ...cacheHeaders,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/stream - Error', { error: error.message, duration: `${duration}ms` });
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
  }
}
