/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath, isWithinShare,
} from '@/lib/shareAuth';
import { join, resolve, extname } from 'node:path';
import fsPromises from 'fs/promises';
import { generateImageThumbnail, generateVideoThumbnail, generatePdfThumbnail, runThumbnailJob } from '@/lib/thumbnailUtils';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS } from '@/lib/extensions';
import { thumbnailCache } from '@/lib/thumbnailCache';
import { isUploadTempName } from '@/lib/uploadTemp';
import { thumbnailKey } from '@/lib/thumbnailKey.mjs';
import { buildValidators, evaluateConditional, mediaCacheControl } from '@/lib/httpRange';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';

export const maxDuration = 60;

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    // Get password from header or query parameter (query param needed for <img> tags)
    const password = req.headers.get('x-share-password') || new URL(req.url).searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Get optional file param for directory shares
    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

    // Refuse in-flight upload temp files — a list refresh fired by an early
    // upload event can request a thumbnail before the rename has happened,
    // which would otherwise cache a broken thumbnail from a partial file.
    if (isUploadTempName(fileName)) {
      return NextResponse.json({ error: 'Upload in progress' }, { status: 404 });
    }

    // Build the path. For directory shares, combine the in-share subPath with
    // the target fileName so we resolve to the actual file rather than its
    // parent directory (otherwise sharp tries to read a folder and fails with
    // "Input file contains unsupported image format").
    let pathCheck;
    if (share.isDirectory) {
      const innerPath = subPath
        ? (fileName && fileName !== share.fileName ? `${subPath}/${fileName}` : subPath)
        : (fileName && fileName !== share.fileName ? fileName : '');
      pathCheck = validateSharePath(share, innerPath);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Private-uploads shares: visitors can only read their own entries
    // (never the share root itself, e.g. a whole-folder zip)
    const privateCheck = await authorizePrivatePath(share, readShareEmail(req, token), shareInnerPath(share, pathCheck.fullPath));
    if (!privateCheck.allowed) {
      return NextResponse.json(privateAccessErrorBody(privateCheck), { status: privateCheck.status });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);

    const filePath = join(uploadsDir, pathCheck.fullPath);

    // Security: prevent directory traversal (including via symlinks)
    if (!(await isWithinShare(share, pathCheck.fullPath))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Cache dirs under UPLOAD_DIR are hidden from share listings; don't serve them either
    if (isCachePath(filePath)) {
      return NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 });
    }

    // Check file exists and capture its size for the (path-independent)
    // thumbnail key.
    let fileStats;
    try {
      fileStats = await fsPromises.stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileExt = extname(fileName).toLowerCase();

    const isImage = IMAGE_EXTENSIONS.includes(fileExt);
    const isVideo = VIDEO_EXTENSIONS.includes(fileExt);
    const isPdf = PDF_EXTENSIONS.includes(fileExt);

    if (!isImage && !isVideo && !isPdf) {
      return NextResponse.json({ error: 'Thumbnail not supported for this file type' }, { status: 404 });
    }

    const validators = buildValidators(fileStats);
    const cacheHeaders = share.privateUploads
      ? { 'Cache-Control': 'private, no-store' }
      : { ETag: validators.etag, 'Last-Modified': validators.lastModified, 'Cache-Control': mediaCacheControl(url) };
    if (!share.privateUploads && evaluateConditional(req, validators, false).notModified) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    // Use the same name+size key as the authenticated thumbnail route so both
    // routes share cached thumbnails for the same file (and survive renames).
    const lastSlash = pathCheck.fullPath.lastIndexOf('/');
    const fileBaseName = lastSlash >= 0 ? pathCheck.fullPath.substring(lastSlash + 1) : pathCheck.fullPath;
    const thumbnailFileName = `${thumbnailKey(fileBaseName, fileStats.size)}.webp`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    await fsPromises.mkdir(thumbnailsDir, { recursive: true });

    // Fast path: check memory cache first
    let cachedBuffer = thumbnailCache.get(thumbnailPath);
    if (cachedBuffer) {
      return new NextResponse(cachedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': cachedBuffer.length.toString(),
          ...cacheHeaders,
          'X-Cache': 'MEMORY',
        },
      });
    }

    // Check if thumbnail exists
    let thumbnailExists = false;
    try {
      await fsPromises.stat(thumbnailPath);
      thumbnailExists = true;
    } catch {
      // Need to generate
    }

    if (!thumbnailExists) {
      try {
        await runThumbnailJob(thumbnailPath, () => {
          if (isPdf) return generatePdfThumbnail(filePath, thumbnailPath);
          if (isVideo) return generateVideoThumbnail(filePath, thumbnailPath);
          // Image (including HEIC/HEIF): sharp handles all formats + auto-rotation
          return generateImageThumbnail(filePath, thumbnailPath);
        });
      } catch (error) {
        return NextResponse.json({ error: 'Thumbnail generation failed', details: error.message }, { status: 500 });
      }
    }

    // Return WebP thumbnail as binary
    let thumbnailBuffer = thumbnailCache.get(thumbnailPath);
    if (!thumbnailBuffer) {
      thumbnailBuffer = await fsPromises.readFile(thumbnailPath);
      thumbnailCache.set(thumbnailPath, thumbnailBuffer);
    }

    return new NextResponse(thumbnailBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnailBuffer.length.toString(),
        ...cacheHeaders,
        'X-Cache': !thumbnailExists ? 'MISS' : 'HIT',
      },
    });
  } catch (error) {
    console.error('GET /api/public/[token]/thumbnail - Error:', error);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
