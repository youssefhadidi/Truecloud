/** @format */

import { NextResponse } from 'next/server';
import { resolve, extname } from 'node:path';
import { logger } from '@/lib/logger';
import { resolveShareFile, sharePasswordFrom, sharePasswordSuffix } from '@/lib/shareFileAccess';
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

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

/**
 * GET /api/public/{token}/transcode-status?path=<in-share path>[&pwd=…][&hevc=N]
 *
 * Share-link twin of /api/files/transcode-status — same states, same steps —
 * with the hlsUrl pointing at the share's HLS route.
 */
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = sharePasswordFrom(req, url);
    const innerPath = url.searchParams.get('path') || '';

    const resolved = await resolveShareFile(req, token, innerPath, { password });
    if (resolved.error) return resolved.error;
    const { fullPath } = resolved;

    const fileExt = extname(fullPath).toLowerCase();

    if (!VIDEO_EXTENSIONS_SET.has(fileExt)) {
      return NextResponse.json({ status: 'native' });
    }

    const components = await readComponentsConfig();
    if (!components.transcoding) {
      return NextResponse.json({ status: 'disabled' });
    }

    // 0. Already probed and natively playable — no HLS needed.
    const cachedProbe = await peekProbeInfo(fullPath);
    if (cachedProbe && isNativelyPlayable(fileExt, cachedProbe)) {
      return NextResponse.json({ status: 'native' });
    }

    // Which rendition this viewer gets; must match what the stream route starts.
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
        logger.warn('public transcode-status: probe failed', { error: err.message });
      }
    }
    const rendition = { variant, maxHeight };

    const hlsParams = new URLSearchParams({ path: innerPath });
    if (variant !== 'h264') hlsParams.set('r', variant);
    if (maxHeight != null) hlsParams.set('mh', String(maxHeight));
    const hlsUrl = `/api/public/${encodeURIComponent(token)}/hls?${hlsParams}${sharePasswordSuffix(password)}`;

    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    let hash, hlsDir;
    try {
      ({ hash, hlsDir } = await getHlsOutputDir(fullPath, cacheDir, rendition));
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    touchHlsJob(hash);

    // 1. HLS fully complete
    if (await isHlsCacheComplete(fullPath, cacheDir, rendition)) {
      return NextResponse.json({ status: 'ready', hlsUrl });
    }

    // 2. Running job with a loadable manifest — start early playback
    const job = getHlsJobStatus(hash);
    if (await isHlsEarlyPlaybackReady(hash, hlsDir)) {
      return NextResponse.json({ status: 'transcoding', progress: job.progress, queuePosition: 0, hlsUrl });
    }

    // 3. In-memory job status
    if (job.status === 'transcoding') {
      return NextResponse.json({ status: 'transcoding', progress: job.progress, queuePosition: job.queuePosition });
    }
    if (job.status === 'done') {
      return NextResponse.json({ status: 'ready', hlsUrl });
    }
    if (job.status === 'error') {
      return NextResponse.json({ status: 'disabled', reason: 'transcode_failed' });
    }

    // 4. Unknown — probe once to detect natively playable files
    try {
      const probe = await getProbeInfo(fullPath, req.signal);
      if (isNativelyPlayable(fileExt, probe)) {
        return NextResponse.json({ status: 'native' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
      logger.warn('public transcode-status: probe failed', { error: err.message });
    }

    // 5. Not started yet — the stream route will begin HLS transcoding
    return NextResponse.json({ status: 'pending' });
  } catch (err) {
    logger.error('GET /api/public/[token]/transcode-status - Error', { error: err.message });
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
