/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { generateImageThumbnail, generateVideoThumbnail, generatePdfThumbnail } from '@/lib/thumbnailUtils';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS } from '@/lib/extensions';
import { Semaphore } from '@/lib/semaphore';
import { thumbnailCache } from '@/lib/thumbnailCache';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export const maxDuration = 60;

// Semaphore for limiting concurrent generation
const thumbnailSemaphore = new Semaphore(20);

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    // Get password from header or query parameter (query param needed for <img> tags)
    const password = req.headers.get('x-share-password') || new URL(req.url).searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
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

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
    const streamCacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);

    let filePath = join(uploadsDir, pathCheck.fullPath);

    // Check file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Security check
    const resolvedPath = resolve(filePath) + sep;
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const fileExt = extname(fileName).toLowerCase();

    // For MP4 videos, check stream-cache
    if (fileExt === '.mp4') {
      const pathHash = createHash('md5').update(filePath).digest('hex');
      const cachedPath = join(streamCacheDir, `${pathHash}.mp4`);
      try {
        await fsPromises.access(cachedPath);
        filePath = cachedPath;
      } catch {
        // Use original
      }
    }

    const isImage = IMAGE_EXTENSIONS.includes(fileExt);
    const isVideo = VIDEO_EXTENSIONS.includes(fileExt);
    const isPdf = PDF_EXTENSIONS.includes(fileExt);

    if (!isImage && !isVideo && !isPdf) {
      return NextResponse.json({ error: 'Thumbnail not supported for this file type' }, { status: 404 });
    }

    // Use the same naming scheme as the authenticated thumbnail route
    // so both routes share cached thumbnails for the same file
    const lastSlash = pathCheck.fullPath.lastIndexOf('/');
    const relativePath = lastSlash >= 0 ? pathCheck.fullPath.substring(0, lastSlash) : '';
    const fileBaseName = lastSlash >= 0 ? pathCheck.fullPath.substring(lastSlash + 1) : pathCheck.fullPath;
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileBaseName}.webp`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    await fsPromises.mkdir(thumbnailsDir, { recursive: true });

    // Fast path: check memory cache first
    let cachedBuffer = thumbnailCache.get(thumbnailPath);
    if (cachedBuffer) {
      return new NextResponse(cachedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': cachedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
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
      await thumbnailSemaphore.acquire();
      try {
        if (isPdf) {
          await generatePdfThumbnail(filePath, thumbnailPath);
        } else if (isVideo) {
          await generateVideoThumbnail(filePath, thumbnailPath);
        } else {
          // Image (including HEIC/HEIF): sharp handles all formats + auto-rotation
          await generateImageThumbnail(filePath, thumbnailPath);
        }
      } catch (error) {
        return NextResponse.json({ error: 'Thumbnail generation failed', details: error.message }, { status: 500 });
      } finally {
        thumbnailSemaphore.release();
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
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Cache': !thumbnailExists ? 'MISS' : 'HIT',
      },
    });
  } catch (error) {
    console.error('GET /api/public/[token]/thumbnail - Error:', error);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
