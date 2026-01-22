/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';

// Increase timeout for thumbnail generation (HEIC and PDF processing can be slow)
export const maxDuration = 60;

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

const thumbnailSemaphore = new Semaphore(10); // Limited parallelization to prevent resource exhaustion

// Helper function to generate image thumbnails with Sharp
async function generateImageThumbnail(filePathOrBuffer, thumbnailPath) {
  const startTime = Date.now();
  const isBuffer = Buffer.isBuffer(filePathOrBuffer); 
  const inputType = isBuffer ? 'buffer' : 'file';
  logger.debug('Starting Sharp thumbnail generation', { type: inputType });

  const sharp = (await import('sharp')).default;

  // Try to process the image with failOnError: false to handle corrupted images
  await sharp(filePathOrBuffer, {
    failOnError: false,
    limitInputPixels: false,
  })
    .resize(150, 150, { fit: 'inside' })
    .webp({ quality: 80 }) // WebP format for better compression
    .toFile(thumbnailPath);

  const duration = Date.now() - startTime;
  logger.debug('Sharp thumbnail generated', { type: inputType, duration: `${duration}ms` });
}

// Helper function to generate video thumbnails with FFmpeg
async function generateVideoThumbnail(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting FFmpeg thumbnail generation', { filePath });

  const ffmpegArgs = [
    '-y',
    '-threads',
    '1', // Limit threads per process for better parallelization
    '-ss',
    '00:00:01.000', // Seek before input for faster processing (skip black frames)
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=200:200:force_original_aspect_ratio=decrease:flags=fast_bilinear', // Fast scaling
    '-q:v',
    '80', // WebP quality (0-100, higher = better quality)
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 20 second timeout for videos (optimized FFmpeg should be faster)
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      const duration = Date.now() - startTime;
      logger.error('FFmpeg timeout', { filePath, duration: `${duration}ms` });
      reject(new Error('FFmpeg timeout after 20 seconds'));
    }, 20000);

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
    
    // Convert directly to JPEG buffer instead of intermediate PNG for speed
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.5, // High quality intermediate
    });

    const sharp = (await import('sharp')).default;
    // Skip withMetadata() for HEIC since we already converted
    await sharp(outputBuffer)
      .resize(200, 200, { fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(thumbnailPath);

    const duration = Date.now() - startTime;
    logger.debug('HEIC thumbnail generated', { filePath, duration: `${duration}ms` });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('HEIC thumbnail generation failed', { filePath, error: error.message, duration: `${duration}ms` });
    throw new Error(`HEIC conversion failed: ${error.message}`);
  }
}

// Helper function to generate PDF thumbnails using ghostscript
async function generatePdfThumbnail(filePath, thumbnailPath) {
  const startTime = Date.now();
  logger.debug('Starting PDF thumbnail generation', { filePath });

  // Use JPEG as intermediate instead of PNG, then convert to WebP
  const jpgPath = thumbnailPath.replace('.webp', '.jpg');

  const gsArgs = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=jpeg',
    '-dFirstPage=1',
    '-dLastPage=1',
    '-r150',
    `-sOutputFile=${jpgPath}`,
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const gs = spawn('gs', gsArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 60 second timeout for PDF processing
    const timeout = setTimeout(() => {
      timedOut = true;
      gs.kill();
      const duration = Date.now() - startTime;
      logger.error('Ghostscript timeout', { filePath, duration: `${duration}ms` });
      reject(new Error('Ghostscript timeout after 60 seconds'));
    }, 60000);

    gs.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gs.on('close', async (code) => {
      clearTimeout(timeout);
      if (timedOut) return;

      if (code !== 0) {
        const duration = Date.now() - startTime;
        logger.error('Ghostscript failed', { filePath, code, duration: `${duration}ms`, errorOutput });
        reject(new Error(`Ghostscript exited with code ${code}: ${errorOutput}`));
        return;
      }

      try {
        // Convert JPEG to WebP
        const sharp = (await import('sharp')).default;
        await sharp(jpgPath).resize(200, 200, { fit: 'inside' }).webp({ quality: 90 }).toFile(thumbnailPath);

        // Clean up temporary JPEG
        await fsPromises.unlink(jpgPath);

        const duration = Date.now() - startTime;
        logger.debug('PDF thumbnail generated', { filePath, duration: `${duration}ms` });
        resolve();
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('PDF thumbnail Sharp conversion failed', { filePath, error: error.message, duration: `${duration}ms` });
        reject(new Error(`Sharp conversion failed: ${error.message}`));
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      logger.error('Ghostscript spawn error', { filePath, error: err.message, duration: `${duration}ms` });
      reject(new Error('Ghostscript is not installed or not in PATH. Install it with: sudo apt-get install ghostscript'));
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
    let relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/thumbnail - Processing', { fileId, path: relativePath });

    // Check permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/thumbnail - Access denied', { fileId, relativePath, userId: session.user.id });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;

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
    const imageExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', 'png','.webp', '.svg', '.ico'];
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

    // Create thumbnail filename - always use WebP format
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.webp`;
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
          // Image: auto-rotate based on EXIF orientation
          const sharp = (await import('sharp')).default;
          
          try {
            // Create a single Sharp instance and get metadata in one operation
            let sharpInstance = sharp(filePath, {
              failOnError: false,
              limitInputPixels: false,
            });
            
            const metadata = await sharpInstance.metadata();
            
            // Map EXIF orientation to transformation
            const orientationRotations = {
              2: { flop: true },
              3: { rotate: 180 },
              4: { flip: true },
              5: { rotate: 90, flop: true },
              6: { rotate: 90 },
              7: { rotate: 270, flop: true },
              8: { rotate: 270 },
            };
            
            const rotation = orientationRotations[metadata.orientation] || null;
            
            // Apply rotation transformations if needed
            if (rotation) {
              if (rotation.rotate) {
                sharpInstance = sharpInstance.rotate(rotation.rotate);
              }
              if (rotation.flip) {
                sharpInstance = sharpInstance.flip();
              }
              if (rotation.flop) {
                sharpInstance = sharpInstance.flop();
              }
            }
            
            // Convert to buffer with metadata (without original orientation)
            const buffer = await sharpInstance.toBuffer();
            await generateImageThumbnail(buffer, thumbnailPath);
          } catch (error) {
            // If orientation detection fails, process without rotation
            logger.warn('Orientation detection failed, processing without rotation', { fileId, error: error.message });
            await generateImageThumbnail(filePath, thumbnailPath);
          }
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
    const dataUrl = `data:image/webp;base64,${base64}`;

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
