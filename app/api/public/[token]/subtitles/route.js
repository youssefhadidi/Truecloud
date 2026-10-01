/** @format */

import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { resolve } from 'node:path';
import { logger } from '@/lib/logger';
import { resolveShareFile, isShareSiblingReadable } from '@/lib/shareFileAccess';
import { listSubtitleTracks, extractSubtitleVtt } from '@/lib/subtitles';

const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

/**
 * GET /api/public/{token}/subtitles?path=<in-share path>[&pwd=…]           → { tracks: [...] }
 * GET /api/public/{token}/subtitles?path=<in-share path>[&pwd=…]&track=N   → text/vtt
 *
 * Share-link twin of /api/files/subtitles. `track` indexes a list rebuilt
 * server-side; the client never names a stream or a sidecar file, and sidecar
 * discovery only looks next to the (already authorised) video.
 */
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const innerPath = url.searchParams.get('path') || '';
    const trackParam = url.searchParams.get('track');

    const resolved = await resolveShareFile(req, token, innerPath);
    if (resolved.error) return resolved.error;
    const { share, fullPath } = resolved;

    let tracks;
    try {
      tracks = await listSubtitleTracks(fullPath, req.signal);
    } catch (err) {
      if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
      throw err;
    }

    // Sidecars are other files: keep only those this visitor could open
    // through the share anyway (never for a single-file share, never a symlink
    // out of it, never another uploader's in a private-uploads share). Ids are
    // renumbered after filtering; the listing and the fetch both filter the
    // same way, so they agree on what `track` means.
    const readable = await Promise.all(
      tracks.map((t) => t.source !== 'sidecar' || isShareSiblingReadable(req, token, share, t.file)),
    );
    tracks = tracks.filter((_, i) => readable[i]).map((t, i) => ({ ...t, id: i }));

    if (trackParam === null) {
      return NextResponse.json({
        tracks: tracks.map(({ id, source, lang, title, codec, available }) => ({
          id, source, lang, title, codec, available,
        })),
      });
    }

    if (!/^\d+$/.test(trackParam)) {
      return NextResponse.json({ error: 'Invalid track' }, { status: 400 });
    }

    const track = tracks[Number(trackParam)];
    if (!track) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }
    if (!track.available) {
      return NextResponse.json(
        { error: 'Track is image-based and cannot be converted to WebVTT', codec: track.codec },
        { status: 415 },
      );
    }

    let vttPath;
    try {
      vttPath = await extractSubtitleVtt(fullPath, resolve(process.cwd(), STREAM_CACHE_DIR), track, req.signal);
    } catch (err) {
      if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
      logger.warn('GET /api/public/[token]/subtitles - extraction failed', { track: track.id, error: err.message });
      return NextResponse.json({ error: 'Subtitle extraction failed' }, { status: 500 });
    }

    const vtt = await readFile(vttPath, 'utf8');

    return new NextResponse(vtt, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Length': Buffer.byteLength(vtt, 'utf8').toString(),
        'Cache-Control': share.privateUploads ? 'private, no-store' : 'private, max-age=3600',
      },
    });
  } catch (err) {
    logger.error('GET /api/public/[token]/subtitles - Error', { error: err.message });
    return NextResponse.json({ error: 'Subtitle request failed' }, { status: 500 });
  }
}
