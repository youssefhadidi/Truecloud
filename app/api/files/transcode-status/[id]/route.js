/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { resolve, join, extname } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { readComponentsConfig } from '@/lib/componentsConfig';
import { isNativelyPlayable } from '@/lib/ffmpegUtils';
import { getProbeInfo, peekProbeInfo } from '@/lib/probeCache';
import { VIDEO_EXTENSIONS } from '@/lib/extensions.mjs';
import { readTranscodingConfig } from '@/lib/transcodingConfig';
import { chooseHlsVariant, parseHevcSupport } from '@/lib/hlsEncode.mjs';
import {
  isHlsCacheComplete,
  isHlsEarlyPlaybackReady,
  getHlsJobStatus,
  getHlsOutputDir,
  touchHlsJob,
} from '@/lib/hlsManager';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

export async function GET(req, { params }) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

    if (relativePath.includes('..') || fileId.includes('..')) {
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
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }
    relativePath = accessCheck.normalizedPath;

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

      // 0. Already probed and natively playable — no HLS needed. Cache-only
      //    lookup so the common poll costs a stat, not a subprocess.
      const cachedProbe = await peekProbeInfo(fullPath);
      if (cachedProbe && isNativelyPlayable(fileExt, cachedProbe)) {
        return NextResponse.json({ status: 'native' });
      }

      // Which rendition this viewer gets — it names the directory to look in,
      // so it must match what the stream route will start. Only a browser
      // that can decode HEVC can get anything but the default, and only then
      // does the choice need the codecs; the probe is cached, and step 4 below
      // would run it on this same poll anyway.
      // maxHeight is part of the rendition's key, so it names the directory too.
      const { maxHeight } = await readTranscodingConfig();
      let variant = 'h264';
      const hevcSupport = parseHevcSupport(url.searchParams.get('hevc'));
      if (hevcSupport) {
        try {
          const probe = await (cachedProbe ?? getProbeInfo(fullPath, req.signal));
          if (isNativelyPlayable(fileExt, probe)) return NextResponse.json({ status: 'native' });
          variant = chooseHlsVariant(probe, { hevcSupport, maxHeight });
        } catch (err) {
          if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
          logger.warn('transcode-status: probe failed', { fullPath, error: err.message });
        }
      }
      const rendition = { variant, maxHeight };

      // Build the hlsUrl used for early and complete playback. Same params as
      // the stream route's: `mh` pins the rendition across a settings change.
      const params = new URLSearchParams({ path: relativePath });
      if (variant !== 'h264') params.set('r', variant);
      if (maxHeight != null) params.set('mh', String(maxHeight));
      const hlsUrl = `/api/files/hls/${encodeURIComponent(fileId)}?${params}`;

      let hash, hlsDir;
      try {
        ({ hash, hlsDir } = await getHlsOutputDir(fullPath, cacheDir, rendition));
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      // The player polls this while a transcode runs; see touchHlsJob.
      touchHlsJob(hash);

      // 1. HLS fully complete (manifest has #EXT-X-ENDLIST)
      const hlsComplete = await isHlsCacheComplete(fullPath, cacheDir, rendition);
      if (hlsComplete) {
        return NextResponse.json({ status: 'ready', hlsUrl });
      }

      // 2. A running job with a manifest the player can load — start early
      //    playback. The HLS route holds each segment request until ffmpeg
      //    writes it, so there is no need to wait for segments here. Leftover
      //    segments without an active job (pre-cached state) fall through to
      //    'pending' so the stream route starts on-demand transcoding.
      const job = getHlsJobStatus(hash);
      if (await isHlsEarlyPlaybackReady(hash, hlsDir)) {
        return NextResponse.json({
          status: 'transcoding',
          progress: job.progress,
          queuePosition: 0,
          hlsUrl,
        });
      }

      // 3. In-memory HLS job status

      if (job.status === 'transcoding') {
        // queuePosition > 0 means this job hasn't reached the encoder yet — it
        // is waiting on the single encode slot behind another file.
        return NextResponse.json({
          status: 'transcoding',
          progress: job.progress,
          queuePosition: job.queuePosition,
        });
      }

      if (job.status === 'done') {
        return NextResponse.json({ status: 'ready', hlsUrl });
      }

      if (job.status === 'error') {
        return NextResponse.json({ status: 'disabled', reason: 'transcode_failed' });
      }

      // 4. Unknown — probe once to detect natively playable files. The result is
      //    persisted by probeCache, so subsequent calls (including across server
      //    restarts) answer from cache, and the stream route reuses this exact
      //    entry rather than probing the file a second time.
      try {
        const probe = await getProbeInfo(fullPath, req.signal);
        if (isNativelyPlayable(fileExt, probe)) {
          return NextResponse.json({ status: 'native' });
        }
      } catch (err) {
        if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
        logger.warn('transcode-status: probe failed', { fullPath, error: err.message });
      }

      // 5. Not started yet — stream route will begin HLS transcoding
      return NextResponse.json({ status: 'pending' });
    }

    // Unsupported / unknown extension — try native
    return NextResponse.json({ status: 'native' });
  } catch (err) {
    logger.error('GET /api/files/transcode-status - Error', { error: err.message });
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
