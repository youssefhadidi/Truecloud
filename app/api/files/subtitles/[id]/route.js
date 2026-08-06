/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { readFile } from 'fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { listSubtitleTracks, extractSubtitleVtt } from '@/lib/subtitles';
import { requireFolderUnlock } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

/**
 * GET /api/files/subtitles/{id}?path=…            → { tracks: [...] }
 * GET /api/files/subtitles/{id}?path=…&track=N    → text/vtt
 *
 * `track` is an index into the list the first form returns, resolved server-side
 * against a freshly built list — the client never names a stream or a file.
 */
export async function GET(req, { params }) {
  try {
    const { error } = await requireAuthNoActivity();
    if (error) return error;

    const resolvedParams = await params;
    const fileId = safeDecodeURIComponent(resolvedParams.id);

    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';
    const trackParam = url.searchParams.get('track');

    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    const fullPath = join(uploadsDir, relativePath, fileId);

    let tracks;
    try {
      tracks = await listSubtitleTracks(fullPath, req.signal);
    } catch (err) {
      if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
      throw err;
    }

    // Listing — strip the fields that only matter server-side.
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
      // Bitmap subtitles (PGS/VobSub) have no text to convert.
      return NextResponse.json(
        { error: 'Track is image-based and cannot be converted to WebVTT', codec: track.codec },
        { status: 415 },
      );
    }

    let vttPath;
    try {
      vttPath = await extractSubtitleVtt(fullPath, cacheDir, track, req.signal);
    } catch (err) {
      if (err.name === 'AbortError') return new NextResponse(null, { status: 499 });
      logger.warn('GET /api/files/subtitles - extraction failed', {
        fullPath,
        track: track.id,
        error: err.message,
      });
      return NextResponse.json({ error: 'Subtitle extraction failed' }, { status: 500 });
    }

    // Subtitle files are small (tens of KB), so buffering beats a stream here.
    const vtt = await readFile(vttPath, 'utf8');

    return new NextResponse(vtt, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Length': Buffer.byteLength(vtt, 'utf8').toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    logger.error('GET /api/files/subtitles - Error', { error: err.message });
    return NextResponse.json({ error: 'Subtitle request failed' }, { status: 500 });
  }
}
