/** @format */

import { NextResponse } from 'next/server';
import fs from 'fs';
import { stat, access } from 'fs/promises';
import { resolve, extname } from 'node:path';
import mime from 'mime-types';
import { logger } from '@/lib/logger';
import { resolveShareFile, sharePasswordFrom, sharePasswordSuffix } from '@/lib/shareFileAccess';
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

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

// Share links are anonymous: cap concurrent ffprobes like the signed-in route
// does, so a visitor flicking through a shared folder can't fork unbounded
// subprocesses. Encodes themselves go through hlsManager's single encode slot.
const probeSemaphore = new Semaphore(3);

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

// Same read size as the signed-in stream route; see the note there.
const STREAM_CHUNK_BYTES = 1024 * 1024;

/**
 * GET /api/public/{token}/stream?path=<in-share path>[&pwd=…][&hevc=N]
 *
 * Mirrors /api/files/stream: natively playable media is served byte-for-byte
 * with range support; any other video starts (or joins) an HLS transcode and
 * answers with its status or the hlsUrl. `file` is still accepted for links
 * built before `path` carried the full in-share path.
 */
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = sharePasswordFrom(req, url);

    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file');
    const innerPath = fileName ? (subPath ? `${subPath}/${fileName}` : fileName) : subPath;

    const resolved = await resolveShareFile(req, token, innerPath, { password });
    if (resolved.error) return resolved.error;
    const { share, fullPath } = resolved;

    try {
      await access(fullPath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileExt = extname(fullPath).toLowerCase();

    // On-demand HLS transcoding, exactly as for signed-in viewers
    if (VIDEO_EXTENSIONS_SET.has(fileExt)) {
      const components = await readComponentsConfig();

      if (components.transcoding) {
        const cachedProbe = await peekProbeInfo(fullPath);
        if (!(cachedProbe && isNativelyPlayable(fileExt, cachedProbe))) {
          if (req.signal?.aborted) return new NextResponse(null, { status: 499 });

          const hwaccel = process.env.HWACCEL?.toLowerCase() === 'none' ? 'none' : 'vaapi';

          try {
            await probeSemaphore.acquire(1, req.signal);
          } catch (err) {
            if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
            throw err;
          }
          let probe, transcodingConfig;
          try {
            if (req.signal?.aborted) return new NextResponse(null, { status: 499 });
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

          if (req.signal?.aborted) return new NextResponse(null, { status: 499 });

          if (!isNativelyPlayable(fileExt, probe)) {
            const variant = chooseHlsVariant(probe, {
              hevcSupport: parseHevcSupport(url.searchParams.get('hevc')),
              maxHeight: transcodingConfig.maxHeight,
            });
            const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
            const job = await startHlsJob(fullPath, cacheDir, probe, hwaccel, probe.durationSecs, {
              maxHeight: transcodingConfig.maxHeight,
              variant,
            });

            if (job.status === 'transcoding') {
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
              const hlsParams = new URLSearchParams({ path: innerPath });
              if (variant !== 'h264') hlsParams.set('r', variant);
              if (transcodingConfig.maxHeight != null) hlsParams.set('mh', String(transcodingConfig.maxHeight));
              const hlsUrl = `/api/public/${encodeURIComponent(token)}/hls?${hlsParams}${sharePasswordSuffix(password)}`;
              return NextResponse.json({ status: 'ready', hlsUrl });
            }

            if (job.status === 'error') {
              logger.warn('GET /api/public/[token]/stream - HLS transcode failed, serving original', { shareId: share.id });
              // Fall through to serve the original file as best-effort
            }
          }
        }
      }
      // Transcoding disabled: serve the original file as-is
    }

    const fileStats = await stat(fullPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

    // Let the browser reuse what it already downloaded (a backward seek is
    // otherwise a full re-fetch). Private-uploads shares are per-visitor
    // (cookie-scoped), so those stay out of every cache.
    const validators = buildValidators(fileStats);
    const cacheHeaders = share.privateUploads
      ? { 'Cache-Control': 'private, no-store' }
      : { ETag: validators.etag, 'Last-Modified': validators.lastModified, 'Cache-Control': 'private, max-age=3600' };

    let parsedRange = parseRangeHeader(req.headers.get('range'), fileSize);

    if (!share.privateUploads) {
      const conditional = evaluateConditional(req, validators, !!parsedRange);
      if (conditional.notModified) {
        return new NextResponse(null, { status: 304, headers: cacheHeaders });
      }
      if (conditional.ignoreRange) parsedRange = null;
    }

    if (parsedRange?.unsatisfiable) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }

    if (!parsedRange) {
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
    logger.error('GET /api/public/[token]/stream - Error', { error: error.message });
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
  }
}
