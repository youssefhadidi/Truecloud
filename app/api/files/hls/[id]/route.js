/** @format */

import { NextResponse } from 'next/server';
import { join, resolve } from 'node:path';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { logger } from '@/lib/logger';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { getHlsOutputDir } from '@/lib/hlsManager';
import { normalizeTranscodingConfig } from '@/lib/transcodingConfig';
import { serveHls, SEGMENT_FILENAME_RE } from '@/lib/hlsServe';
import { requireFolderUnlock, extractIncomingPin, findAncestorLockPath, getAllLockedPaths } from '@/lib/folderLocks';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

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

    // If this manifest request itself carried a folderPin (header, query, or
    // map), the segment URLs need to carry it too — the HLS player fetches
    // segments directly via <video src>/hls.js and won't replay our request
    // headers on each segment.
    let pinSuffix = '';
    if (!segment) {
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
    const segmentBaseUrl = `/api/files/hls/${encodeURIComponent(fileId)}?path=${encodeURIComponent(relativePath)}${pinSuffix}${variantSuffix}${maxHeightSuffix}&v=${hash}&segment=`;

    return await serveHls(req, { hash, hlsDir, segment, version: url.searchParams.get('v'), segmentBaseUrl });
  } catch (err) {
    logger.error('GET /api/files/hls - Error', { error: err.message });
    return NextResponse.json({ error: 'HLS serve failed' }, { status: 500 });
  }
}
