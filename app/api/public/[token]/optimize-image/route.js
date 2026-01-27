/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import fs from 'fs';
import { stat } from 'fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { getOrConvertHeicToJpeg } from '@/lib/heicUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export const maxDuration = 30;

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;
    const quality = Math.min(Math.max(parseInt(url.searchParams.get('quality') || '80'), 30), 100);
    const maxWidth = parseInt(url.searchParams.get('w') || '2000');
    const maxHeight = parseInt(url.searchParams.get('h') || '2000');

    // Build the path
    let pathCheck;
    if (share.isDirectory && subPath) {
      pathCheck = validateSharePath(share, subPath);
    } else if (share.isDirectory && fileName !== share.fileName) {
      pathCheck = validateSharePath(share, fileName);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(filePath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileStats = await stat(filePath);

    // Only process image files
    const mimeType = lookup(fileName) || 'application/octet-stream';
    if (!mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Only images can be optimized' }, { status: 400 });
    }

    // Skip optimization for very small files or SVG
    if (mimeType === 'image/svg+xml' || fileStats.size < 100000) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    try {
      // For HEIC files, use cached JPEG version
      let optimizePath = filePath;
      const fileExt = extname(fileName).toLowerCase();
      const isHeic = fileExt === '.heic' || fileExt === '.heif';

      if (isHeic) {
        optimizePath = await getOrConvertHeicToJpeg(filePath);
      }

      // Optimize image using sharp
      let pipeline = sharp(optimizePath, {
        failOnError: false,
        limitInputPixels: false,
      });

      const metadata = await pipeline.metadata();

      // Auto-rotate based on EXIF orientation
      const orientationRotations = {
        2: { flop: true },
        3: { rotate: 180 },
        4: { flip: true },
        5: { rotate: 90, flop: true },
        6: { rotate: 90 },
        7: { rotate: 270, flop: true },
        8: { rotate: 270 },
      };

      const rotation = orientationRotations[metadata.orientation];
      if (rotation) {
        if (rotation.rotate) pipeline = pipeline.rotate(rotation.rotate);
        if (rotation.flip) pipeline = pipeline.flip();
        if (rotation.flop) pipeline = pipeline.flop();
      }

      // Resize if needed
      const shouldResize = metadata.width > maxWidth || metadata.height > maxHeight;

      if (shouldResize) {
        pipeline = pipeline.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Convert to WebP for better compression
      const optimizedBuffer = await pipeline.toFormat('webp', { quality }).toBuffer();

      return new NextResponse(optimizedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': optimizedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    } catch (sharpError) {
      // If sharp fails, return original image
      console.error('Image optimization failed:', sharpError);
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileStats.size.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
  } catch (error) {
    console.error('GET /api/public/[token]/optimize-image - Error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
