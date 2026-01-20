/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname, basename } from 'node:path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './thumbnails';
const STREAM_CACHE_DIR = './stream-cache';

// Semaphore to limit concurrent thumbnail generation
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++;
      logger.debug('Semaphore acquired', { active: this.count, max: this.max, queued: this.queue.length });
      return Promise.resolve();
    }

    logger.debug('Semaphore waiting', { active: this.count, max: this.max, queued: this.queue.length });
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.count--;
    logger.debug('Semaphore released', { active: this.count, max: this.max, queued: this.queue.length });
    if (this.queue.length > 0) {
      this.count++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

// Create a global semaphore with max 10 concurrent thumbnail generations
const thumbnailSemaphore = new Semaphore(10);

// Helper function to generate thumbnails with FFmpeg
async function generateThumbnail(filePath, thumbnailPath, isVideo) {
  const startTime = Date.now();
  logger.debug('Starting FFmpeg thumbnail generation', { filePath, isVideo });

  const ffmpegArgs = ['-y', '-i', filePath];

  if (isVideo) {
    // Extract first frame (faster than seeking to 1 second)
    ffmpegArgs.push('-ss', '00:00:00.000');
  }

  // Extract only the first frame
  ffmpegArgs.push('-frames:v', '1');

  // Optimize: smaller size, faster compression (JPG format)
  ffmpegArgs.push(
    '-vf',
    'scale=150:150:force_original_aspect_ratio=decrease',
    '-q:v',
    '15', // JPG quality (1-31, higher = faster/lower quality)
    thumbnailPath,
  );

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 30 second timeout for videos (GoPro files can be large)
    const timeoutDuration = isVideo ? 30000 : 10000;
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      const duration = Date.now() - startTime;
      logger.error('FFmpeg timeout', { filePath, duration: `${duration}ms`, timeoutDuration });
      reject(new Error(`FFmpeg timeout after ${timeoutDuration / 1000} seconds`));
    }, timeoutDuration);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.debug('FFmpeg thumbnail generated', { filePath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('FFmpeg failed', { filePath, code, duration: `${duration}ms`, errorOutput });
        reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      logger.error('FFmpeg spawn error', { filePath, error: err.message, duration: `${duration}ms` });
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// Helper function to generate HEIC/HEIF thumbnails
async function generateHeicThumbnail(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting HEIC thumbnail generation', { filePath });

  try {
    // Use heic-convert to convert HEIC to JPEG buffer
    const { promisify } = await import('util');
    const heicConvert = (await import('heic-convert')).default;

    const inputBuffer = await fsPromises.readFile(filePath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.85,
    });

    // Use sharp to resize the converted image
    const sharp = (await import('sharp')).default;
    await sharp(outputBuffer).resize(150, 150, { fit: 'inside' }).jpeg({ quality: 85 }).toFile(thumbnailPath);

    const duration = Date.now() - startTime;
    logger.debug('HEIC thumbnail generated', { filePath, duration: `${duration}ms` });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('HEIC thumbnail generation failed', { filePath, error: error.message, duration: `${duration}ms` });
    throw new Error(`HEIC conversion failed: ${error.message}`);
  }
}

// Helper function to generate PDF thumbnails
async function generatePdfThumbnail(filePath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    // Use ImageMagick's magick command directly (requires Ghostscript for PDF support)
    const args = [
      '-density',
      '680', // Reduced from 150 for faster processing
      `${filePath}[0]`, // First page only - must come after density
      '-quality',
      '65', // Reduced from 80 for faster processing
      '-resize',
      '150x150',
      thumbnailPath,
    ];

    const magick = spawn('magick', args);
    let errorOutput = '';
    let timedOut = false;

    // Set 15 second timeout for PDF processing
    const timeout = setTimeout(() => {
      timedOut = true;
      magick.kill();
      reject(new Error('ImageMagick timeout after 15 seconds'));
    }, 15000);

    magick.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    magick.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code === 0) {
        resolve();
      } else {
        console.error('ImageMagick PDF failed with code:', code);
        console.error('ImageMagick error output:', errorOutput);
        if (errorOutput.includes('gswin') || errorOutput.includes('Ghostscript')) {
          reject(new Error('Ghostscript is required for PDF thumbnails. Install from https://ghostscript.com/releases/gsdnld.html'));
        } else {
          reject(new Error(`ImageMagick PDF exited with code ${code}`));
        }
      }
    });

    magick.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      console.error('ImageMagick spawn error:', err);
      reject(new Error(`ImageMagick spawn error: ${err.message}`));
    });
  });
}

export async function GET(req, { params }) {
  const startTime = Date.now();
  let fileId = 'unknown';
  try {
    logger.debug('GET /api/files/thumbnail - Request received');
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/thumbnail - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    fileId = decodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/thumbnail - Processing', { fileId, path: relativePath });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/thumbnail - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
    const streamCacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
    let filePath = join(uploadsDir, relativePath, fileId);

    logger.info('GET /api/files/thumbnail - Paths', {
      cwd: process.cwd(),
      UPLOAD_DIR,
      THUMBNAIL_DIR,
      uploadsDir,
      thumbnailsDir,
      filePath,
      relativePath,
      fileId,
    });

    // Check if file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      logger.warn('GET /api/files/thumbnail - File not found', { filePath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Get file extension for type detection
    const fileExt = extname(fileId).toLowerCase();

    // For MP4 videos, check if we have a stream-cache version (faster to process)
    if (fileExt === '.mp4') {
      const pathHash = createHash('md5').update(filePath).digest('hex');
      const cachedPath = join(streamCacheDir, `${pathHash}.mp4`);

      try {
        await fsPromises.access(cachedPath);
        logger.debug('GET /api/files/thumbnail - Using stream-cache version for thumbnail', { fileId, cachedPath });
        filePath = cachedPath;
      } catch {
        // No cached version, use original
        logger.debug('GET /api/files/thumbnail - No stream-cache version, using original', { fileId });
      }
    }

    // Supported image, video, and PDF extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    const heicExtensions = ['.heic', '.heif'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
    const pdfExtensions = ['.pdf'];

    const isImage = imageExtensions.includes(fileExt);
    const isHeic = heicExtensions.includes(fileExt);
    const isVideo = videoExtensions.includes(fileExt);
    const isPdf = pdfExtensions.includes(fileExt);

    if (!isImage && !isHeic && !isVideo && !isPdf) {
      logger.debug('GET /api/files/thumbnail - Unsupported file type', { fileId, fileExt });
      return NextResponse.json({ error: 'Thumbnail generation not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail filename - always use JPG format
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.jpg`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    // Ensure thumbnails directory exists
    try {
      await fsPromises.mkdir(thumbnailsDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create thumbnails directory:', err);
    }

    // Check for old PNG thumbnail and delete it
    const oldPngThumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.png`;
    const oldPngThumbnailPath = join(thumbnailsDir, oldPngThumbnailFileName);
    try {
      await fsPromises.unlink(oldPngThumbnailPath);
    } catch (err) {
      // File doesn't exist, that's fine
    }

    // Check if JPG thumbnail already exists
    try {
      const stats = await fsPromises.stat(thumbnailPath);
      const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

      // Check if client has cached version
      const ifNoneMatch = req.headers.get('if-none-match');
      if (ifNoneMatch === etag) {
        const duration = Date.now() - startTime;
        logger.debug('GET /api/files/thumbnail - Cache hit (304)', { fileId, duration: `${duration}ms` });
        return new NextResponse(null, { status: 304 });
      }

      // Stream the file instead of reading into memory
      const fileStream = fs.createReadStream(thumbnailPath);
      const duration = Date.now() - startTime;
      logger.debug('GET /api/files/thumbnail - Serving cached thumbnail', { fileId, duration: `${duration}ms` });
      return new NextResponse(fileStream, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: etag,
          'Content-Length': stats.size.toString(),
        },
      });
    } catch (err) {
      // File doesn't exist yet, proceed to generation
      logger.debug('GET /api/files/thumbnail - No cached thumbnail, generating', { fileId });
    }

    // Generate thumbnail for videos and images using ffmpeg (JPG format)
    try {
      // Acquire semaphore before generating thumbnail
      logger.debug('GET /api/files/thumbnail - Acquiring semaphore', { fileId });
      await thumbnailSemaphore.acquire();

      try {
        logger.info('GET /api/files/thumbnail - Generating thumbnail', { fileId, isPdf, isHeic, isVideo, isImage });
        if (isPdf) {
          await generatePdfThumbnail(filePath, thumbnailPath);
        } else if (isHeic) {
          await generateHeicThumbnail(filePath, thumbnailPath);
        } else {
          await generateThumbnail(filePath, thumbnailPath, isVideo);
        }

        try {
          const stats = await fsPromises.stat(thumbnailPath);
          const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

          // Stream the newly generated file
          const fileStream = fs.createReadStream(thumbnailPath);
          const duration = Date.now() - startTime;
          logger.info('GET /api/files/thumbnail - Thumbnail generated and served', { fileId, duration: `${duration}ms` });
          return new NextResponse(fileStream, {
            headers: {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=31536000, immutable',
              ETag: etag,
              'Content-Length': stats.size.toString(),
            },
          });
        } catch (err) {
          logger.error('GET /api/files/thumbnail - Failed to read generated thumbnail', { fileId, error: err.message });
          // Failed to read generated file
        }
      } finally {
        // Always release the semaphore
        thumbnailSemaphore.release();
      }
    } catch (error) {
      logger.error('GET /api/files/thumbnail - Generation failed', { fileId, type: isPdf ? 'PDF' : isVideo ? 'video' : 'image', error: error.message });
      // Return 404 so the UI can fall back to the icon
      return NextResponse.json(
        {
          error: 'Thumbnail generation not available',
          message: 'FFmpeg is required for thumbnails. Install it from https://ffmpeg.org/download.html',
        },
        { status: 404 },
      );
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/thumbnail - Unexpected error', error);
    logger.error('GET /api/files/thumbnail - Error details', {
      fileId,
      duration: `${duration}ms`,
    });
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
