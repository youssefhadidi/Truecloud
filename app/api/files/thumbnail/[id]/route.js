/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';

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

const thumbnailSemaphore = new Semaphore(10);

// Helper function to generate image thumbnails with Sharp
async function generateImageThumbnail(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting Sharp thumbnail generation', { filePath });

  try {
    const sharp = (await import('sharp')).default;

    // Try to process the image with failOnError: false to handle corrupted images
    await sharp(filePath, {
      failOnError: false,
      limitInputPixels: false,
    })
      .resize(150, 150, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toFile(thumbnailPath);

    const duration = Date.now() - startTime;
    logger.debug('Sharp thumbnail generated', { filePath, duration: `${duration}ms` });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Sharp thumbnail generation failed', { filePath, error: error.message, duration: `${duration}ms` });

    // If Sharp fails with JPEG error, try using FFmpeg as fallback
    if (error.message.includes('VipsJpeg') || error.message.includes('JPEG')) {
      logger.warn('Sharp failed with JPEG error, attempting FFmpeg fallback', { filePath });
      try {
        await generateImageThumbnailWithFFmpeg(filePath, thumbnailPath);
        const fallbackDuration = Date.now() - startTime;
        logger.debug('FFmpeg fallback thumbnail generated', { filePath, duration: `${fallbackDuration}ms` });
        return;
      } catch (ffmpegError) {
        logger.error('FFmpeg fallback also failed', { filePath, error: ffmpegError.message });
        throw new Error(`Image conversion failed: ${error.message}`);
      }
    }

    throw new Error(`Sharp conversion failed: ${error.message}`);
  }
}

// Helper function to generate image thumbnails with FFmpeg (fallback for corrupted images)
async function generateImageThumbnailWithFFmpeg(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting FFmpeg image thumbnail generation', { filePath });

  const ffmpegArgs = [
    '-y',
    '-i',
    filePath,
    '-vf',
    'scale=150:150:force_original_aspect_ratio=decrease',
    '-q:v',
    '5', // JPG quality (1-31, lower = better quality)
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 15 second timeout for images
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      const duration = Date.now() - startTime;
      logger.error('FFmpeg image timeout', { filePath, duration: `${duration}ms` });
      reject(new Error('FFmpeg timeout after 15 seconds'));
    }, 15000);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.debug('FFmpeg image thumbnail generated', { filePath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('FFmpeg image failed', { filePath, code, duration: `${duration}ms`, errorOutput });
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

// Helper function to generate video thumbnails with FFmpeg
async function generateVideoThumbnail(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting FFmpeg thumbnail generation', { filePath });

  const ffmpegArgs = [
    '-y',
    '-i',
    filePath,
    '-ss',
    '00:00:00.000', // Extract first frame
    '-frames:v',
    '1',
    '-vf',
    'scale=150:150:force_original_aspect_ratio=decrease',
    '-q:v',
    '15', // JPG quality (1-31, higher = faster/lower quality)
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 30 second timeout for videos
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      const duration = Date.now() - startTime;
      logger.error('FFmpeg timeout', { filePath, duration: `${duration}ms` });
      reject(new Error('FFmpeg timeout after 30 seconds'));
    }, 30000);

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
    const heicConvert = (await import('heic-convert')).default;
    const inputBuffer = await fsPromises.readFile(filePath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'PNG', // Use PNG to avoid double JPEG compression
    });

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
  const startTime = Date.now();
  logger.debug('Starting PDF thumbnail generation', { filePath });

  return new Promise((resolve, reject) => {
    const args = ['-density', '80', `${filePath}[0]`, '-quality', '65', '-resize', '150x150', thumbnailPath];

    let magick;
    try {
      magick = spawn('convert', args);
    } catch (spawnError) {
      const duration = Date.now() - startTime;
      logger.error('ImageMagick not found', { filePath, error: spawnError.message, duration: `${duration}ms` });
      reject(new Error('ImageMagick is not installed or not in PATH'));
      return;
    }

    let errorOutput = '';
    let timedOut = false;

    // Set 60 second timeout for PDF processing (increased from 15s)
    const timeout = setTimeout(() => {
      timedOut = true;
      magick.kill();
      const duration = Date.now() - startTime;
      logger.error('ImageMagick timeout', { filePath, duration: `${duration}ms` });
      reject(new Error('ImageMagick timeout after 60 seconds'));
    }, 60000);

    magick.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    magick.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.debug('PDF thumbnail generated', { filePath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('ImageMagick failed', { filePath, code, duration: `${duration}ms`, errorOutput });
        if (errorOutput.includes('gswin') || errorOutput.includes('Ghostscript')) {
          reject(new Error('Ghostscript is required for PDF thumbnails'));
        } else {
          reject(new Error(`ImageMagick exited with code ${code}`));
        }
      }
    });

    magick.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      logger.error('ImageMagick spawn error', { filePath, error: err.message, duration: `${duration}ms` });
      reject(new Error('ImageMagick is not installed or not in PATH'));
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
        logger.debug('GET /api/files/thumbnail - No stream-cache version, using original', { fileId });
      }
    }

    // Supported file extensions
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
    await fsPromises.mkdir(thumbnailsDir, { recursive: true });

    // Check if thumbnail already exists
    let thumbnailExists = false;
    try {
      await fsPromises.stat(thumbnailPath);
      thumbnailExists = true;
    } catch {
      // Doesn't exist yet
    }

    // If thumbnail doesn't exist, generate it now (synchronously)
    if (!thumbnailExists) {
      logger.info('GET /api/files/thumbnail - Generating thumbnail', { fileId, isPdf, isHeic, isVideo, isImage });

      await thumbnailSemaphore.acquire();
      try {
        if (isPdf) {
          await generatePdfThumbnail(filePath, thumbnailPath);
        } else if (isHeic) {
          await generateHeicThumbnail(filePath, thumbnailPath);
        } else if (isVideo) {
          await generateVideoThumbnail(filePath, thumbnailPath);
        } else {
          await generateImageThumbnail(filePath, thumbnailPath);
        }
        logger.info('GET /api/files/thumbnail - Generation complete', { fileId });
      } catch (error) {
        logger.error('GET /api/files/thumbnail - Generation failed', { fileId, error: error.message });

        // Return a more specific error message instead of crashing
        const errorMessage = error.message.includes('ImageMagick')
          ? 'PDF thumbnails require ImageMagick to be installed'
          : error.message.includes('FFmpeg')
            ? 'Video thumbnails require FFmpeg to be installed'
            : 'Thumbnail generation failed';

        return NextResponse.json(
          {
            error: errorMessage,
            details: error.message,
          },
          { status: 500 },
        );
      } finally {
        thumbnailSemaphore.release();
      }
    }

    // Read thumbnail and convert to base64
    const thumbnailBuffer = await fsPromises.readFile(thumbnailPath);
    const base64 = thumbnailBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    const duration = Date.now() - startTime;
    logger.debug('GET /api/files/thumbnail - Returning base64', {
      fileId,
      duration: `${duration}ms`,
      generated: !thumbnailExists,
    });

    return NextResponse.json({
      data: dataUrl,
      generated: !thumbnailExists,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GET /api/files/thumbnail - Unexpected error', {
      fileId,
      error: error.message,
      duration: `${duration}ms`,
    });
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
