/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import fs from 'fs';
import { stat, readFile, mkdir, access } from 'fs/promises';
import { join, basename, resolve, extname } from 'node:path';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_JPEG_CACHE_DIR = process.env.HEIC_JPEG_CACHE_DIR || './.heic-jpeg-cache';

// Image optimization may take time, set appropriate timeout
export const maxDuration = 30;

// Helper function to convert HEIC to JPEG and cache it
async function getOrConvertHeicToJpeg(filePath) {
  const pathHash = createHash('md5').update(filePath).digest('hex');
  const cachedJpegPath = join(resolve(process.cwd(), HEIC_JPEG_CACHE_DIR), `${pathHash}.jpg`);
  
  // Check if we already have the JPEG cached
  try {
    await access(cachedJpegPath);
    return cachedJpegPath;
  } catch {
    // Cache miss, need to convert
  }

  // Ensure cache directory exists
  await mkdir(resolve(process.cwd(), HEIC_JPEG_CACHE_DIR), { recursive: true });

  // Use FFmpeg with libheif to convert HEIC to JPEG
  const ffmpegArgs = [
    '-y',
    '-i',
    filePath,
    '-q:v',
    '2', // Very high quality JPEG (1-31, lower is better)
    cachedJpegPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';

    const timeout = setTimeout(() => {
      ffmpeg.kill();
      reject(new Error('HEIC to JPEG conversion timeout'));
    }, 45000);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(cachedJpegPath);
      } else {
        reject(new Error(`FFmpeg conversion failed: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const fileName = decodeURIComponent(id);

    // Get path and quality from query params
    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';
    const quality = Math.min(Math.max(parseInt(url.searchParams.get('quality') || '80'), 30), 100);
    const maxWidth = parseInt(url.searchParams.get('w') || '2000');
    const maxHeight = parseInt(url.searchParams.get('h') || '2000');

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileName.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check user permissions
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

    // Use normalized path
    relativePath = accessCheck.normalizedPath;

    const filePath = join(UPLOAD_DIR, relativePath, fileName);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
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

      // Get metadata and apply EXIF orientation rotation in one operation
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
        if (rotation.rotate) {
          pipeline = pipeline.rotate(rotation.rotate);
        }
        if (rotation.flip) {
          pipeline = pipeline.flip();
        }
        if (rotation.flop) {
          pipeline = pipeline.flop();
        }
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
      const format = 'webp';
      const optimizedBuffer = await pipeline.toFormat(format, { quality }).toBuffer();

      return new NextResponse(optimizedBuffer, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': optimizedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    } catch (sharpError) {
      // If sharp fails, return original image
      console.error('Image optimization failed, serving original:', sharpError);
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
    console.error('Optimize image error:', error);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
