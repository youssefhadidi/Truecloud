/** @format */

import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import { logger } from '@/lib/logger';
import { resolveShareFile, sharePasswordFrom, sharePasswordSuffix } from '@/lib/shareFileAccess';
import { getHlsOutputDir } from '@/lib/hlsManager';
import { normalizeTranscodingConfig } from '@/lib/transcodingConfig';
import { serveHls, SEGMENT_FILENAME_RE } from '@/lib/hlsServe';

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

/**
 * GET /api/public/{token}/hls?path=<in-share path>[&pwd=…][&r=hevc][&mh=N][&segment=segN.ts]
 *
 * Share-link twin of /api/files/hls. Only serves renditions that already
 * exist — transcodes are started by the share's stream route.
 */
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = sharePasswordFrom(req, url);
    const innerPath = url.searchParams.get('path') || '';
    const segment = url.searchParams.get('segment') || null;
    // Anything unrecognised is the default rendition, and mh is normalised to
    // a valid preset: a tampered value can only pick another rendition of the
    // same authorised file.
    const variant = url.searchParams.get('r') === 'hevc' ? 'hevc' : 'h264';
    const { maxHeight } = normalizeTranscodingConfig({ maxHeight: url.searchParams.get('mh') });

    if (segment !== null && !SEGMENT_FILENAME_RE.test(segment)) {
      return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
    }

    const resolved = await resolveShareFile(req, token, innerPath, { password });
    if (resolved.error) return resolved.error;

    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    let hash, hlsDir;
    try {
      ({ hash, hlsDir } = await getHlsOutputDir(resolved.fullPath, cacheDir, { variant, maxHeight }));
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const variantSuffix = variant === 'h264' ? '' : `&r=${variant}`;
    const maxHeightSuffix = maxHeight == null ? '' : `&mh=${maxHeight}`;
    const segmentBaseUrl =
      `/api/public/${encodeURIComponent(token)}/hls?path=${encodeURIComponent(innerPath)}` +
      `${sharePasswordSuffix(password)}${variantSuffix}${maxHeightSuffix}&v=${hash}&segment=`;

    return await serveHls(req, { hash, hlsDir, segment, version: url.searchParams.get('v'), segmentBaseUrl });
  } catch (err) {
    logger.error('GET /api/public/[token]/hls - Error', { error: err.message });
    return NextResponse.json({ error: 'HLS serve failed' }, { status: 500 });
  }
}
