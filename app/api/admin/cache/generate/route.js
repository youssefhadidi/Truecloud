/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { resolve, join, extname } from 'node:path';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { lookup } from 'mime-types';
import { getOrConvertHeicToJpeg } from '@/lib/heicUtils';
import {
  applyExifRotation,
  generateImageThumbnail,
  generateVideoThumbnail as generateVideoThumb,
  generateHeicThumbnail as generateHeicThumb,
  generatePdfThumbnail as generatePdfThumb,
} from '@/lib/thumbnailUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';

// Supported extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.bmp', '.png', '.webp', '.ico'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
const PDF_EXTENSIONS = ['.pdf'];

// All thumbnail-supported extensions
const THUMBNAIL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...HEIC_EXTENSIONS, ...VIDEO_EXTENSIONS, ...PDF_EXTENSIONS];

// Optimized image extensions (images only, excluding svg)
const OPTIMIZE_EXTENSIONS = [...IMAGE_EXTENSIONS, ...HEIC_EXTENSIONS];

// Stream-optimizable video extensions (MP4 only needs moov fix)
const STREAM_EXTENSIONS = ['.mp4'];

// Semaphore for limiting concurrent operations
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.count--;
    if (this.queue.length > 0) {
      this.count++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

const generationSemaphore = new Semaphore(15);

// Helper to scan directory recursively
async function scanDirectory(dirPath, basePath = '') {
  const files = [];

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) continue;
      // Skip trash folder
      if (entry.name === 'trash' && basePath === '') continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: fullPath,
          relativePath: basePath,
          fullRelativePath: relativePath,
        });
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
  }

  return files;
}

// Generate thumbnail for a single file
async function generateThumbnail(file) {
  const ext = extname(file.name).toLowerCase();
  const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
  const thumbnailFileName = `${file.relativePath.replace(/[/\\]/g, '_')}_${file.name}.webp`;
  const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

  // Check if thumbnail already exists
  try {
    await fsPromises.stat(thumbnailPath);
    return { skipped: true, reason: 'exists' };
  } catch {
    // Doesn't exist, generate it
  }

  // Ensure thumbnails directory exists
  await fsPromises.mkdir(thumbnailsDir, { recursive: true });

  try {
    if (IMAGE_EXTENSIONS.includes(ext)) {
      const sharp = (await import('sharp')).default;
      let sharpInstance = sharp(file.path, { failOnError: false, limitInputPixels: false });
      const metadata = await sharpInstance.metadata();
      sharpInstance = applyExifRotation(sharpInstance, metadata);
      const buffer = await sharpInstance.toBuffer();
      await generateImageThumbnail(buffer, thumbnailPath);
      return { success: true };
    } else if (HEIC_EXTENSIONS.includes(ext)) {
      await generateHeicThumb(file.path, thumbnailPath, file.name);
      return { success: true };
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      await generateVideoThumb(file.path, thumbnailPath, 30000);
      return { success: true };
    } else if (PDF_EXTENSIONS.includes(ext)) {
      await generatePdfThumb(file.path, thumbnailPath);
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }

  return { skipped: true, reason: 'unsupported' };
}

// Generate optimized image for a single file
async function generateOptimized(file) {
  const ext = extname(file.name).toLowerCase();
  const mimeType = lookup(file.name) || 'application/octet-stream';

  // Skip non-images and SVGs
  if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
    return { skipped: true, reason: 'not-image' };
  }

  // Skip small files
  try {
    const stats = await fsPromises.stat(file.path);
    if (stats.size < 100000) {
      return { skipped: true, reason: 'too-small' };
    }
  } catch {
    return { success: false, error: 'Cannot stat file' };
  }

  const quality = 80;
  const maxWidth = 1440;
  const maxHeight = 1440;

  const cacheKey = createHash('md5').update(`${file.path}-${quality}-${maxWidth}-${maxHeight}`).digest('hex');
  const cacheDir = resolve(process.cwd(), OPTI_CACHE_DIR, file.relativePath);
  const cachedPath = join(cacheDir, `${cacheKey}.webp`);

  // Check if already cached
  try {
    await fsPromises.stat(cachedPath);
    return { skipped: true, reason: 'exists' };
  } catch {
    // Doesn't exist, generate it
  }

  await fsPromises.mkdir(cacheDir, { recursive: true });

  const sharp = (await import('sharp')).default;

  try {
    let inputPath = file.path;

    // Handle HEIC
    if (HEIC_EXTENSIONS.includes(ext)) {
      inputPath = await getOrConvertHeicToJpeg(file.path, file.name);
    }

    await sharp(inputPath, { failOnError: false, limitInputPixels: false })
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toFile(cachedPath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Generate stream-optimized MP4 (move moov atom to beginning)
async function generateStream(file) {
  const ext = extname(file.name).toLowerCase();

  if (!STREAM_EXTENSIONS.includes(ext)) {
    return { skipped: true, reason: 'not-mp4' };
  }

  const pathHash = createHash('md5').update(file.path).digest('hex');
  const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
  const cachedPath = join(cacheDir, `${pathHash}.mp4`);

  // Check if already cached
  try {
    const [sourceStats, cachedStats] = await Promise.all([
      fsPromises.stat(file.path),
      fsPromises.stat(cachedPath),
    ]);
    // Use cache if it's newer than source
    if (cachedStats.mtime >= sourceStats.mtime) {
      return { skipped: true, reason: 'exists' };
    }
  } catch {
    // Cache doesn't exist, continue
  }

  await fsPromises.mkdir(cacheDir, { recursive: true });

  // Use FFmpeg to move moov atom to beginning
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', file.path,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-movflags', 'faststart',
      '-y',
      cachedPath,
    ]);

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      resolve({ success: false, error: 'FFmpeg timeout (5 min)' });
    }, 300000); // 5 minute timeout

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `FFmpeg exited with code ${code}` });
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      resolve({ success: false, error: err.message });
    });
  });
}

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const { path: targetPath = '', type = 'thumbnails' } = body;

    if (!['thumbnails', 'optimized', 'stream', 'both', 'all'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Resolve directory
    const uploadDir = resolve(process.cwd(), UPLOAD_DIR);
    const scanDir = targetPath ? join(uploadDir, targetPath) : uploadDir;

    // Verify directory exists
    try {
      const stats = await fsPromises.stat(scanDir);
      if (!stats.isDirectory()) {
        return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Scan directory
          send({ status: 'scanning', message: 'Scanning directory...' });
          const allFiles = await scanDirectory(scanDir, targetPath);

          // Filter files based on type
          let eligibleFiles = [];
          if (type === 'thumbnails' || type === 'both' || type === 'all') {
            const thumbFiles = allFiles.filter(f => {
              const ext = extname(f.name).toLowerCase();
              return THUMBNAIL_EXTENSIONS.includes(ext);
            });
            eligibleFiles.push(...thumbFiles.map(f => ({ ...f, generateType: 'thumbnail' })));
          }
          if (type === 'optimized' || type === 'both' || type === 'all') {
            const optFiles = allFiles.filter(f => {
              const ext = extname(f.name).toLowerCase();
              return OPTIMIZE_EXTENSIONS.includes(ext);
            });
            eligibleFiles.push(...optFiles.map(f => ({ ...f, generateType: 'optimized' })));
          }
          if (type === 'stream' || type === 'all') {
            const streamFiles = allFiles.filter(f => {
              const ext = extname(f.name).toLowerCase();
              return STREAM_EXTENSIONS.includes(ext);
            });
            eligibleFiles.push(...streamFiles.map(f => ({ ...f, generateType: 'stream' })));
          }

          const total = eligibleFiles.length;
          send({ status: 'starting', total, message: `Found ${total} files to process` });

          let processed = 0;
          let successful = 0;
          let failed = 0;
          let skipped = 0;
          const startTime = Date.now();

          // Process files
          for (const file of eligibleFiles) {
            await generationSemaphore.acquire();

            try {
              let result;
              if (file.generateType === 'thumbnail') {
                result = await generateThumbnail(file);
              } else if (file.generateType === 'optimized') {
                result = await generateOptimized(file);
              } else if (file.generateType === 'stream') {
                result = await generateStream(file);
              } else {
                result = { skipped: true, reason: 'unknown-type' };
              }

              processed++;

              if (result.skipped) {
                skipped++;
              } else if (result.success) {
                successful++;
              } else {
                failed++;
              }

              // Send progress every 10 files or at the end
              if (processed % 10 === 0 || processed === total) {
                send({
                  status: 'progress',
                  processed,
                  total,
                  successful,
                  failed,
                  skipped,
                  current: file.name,
                  type: file.generateType,
                });
              }
            } catch (err) {
              processed++;
              failed++;
              send({
                status: 'progress',
                processed,
                total,
                current: file.name,
                type: file.generateType,
                error: err.message,
              });
            } finally {
              generationSemaphore.release();
            }
          }

          const duration = Math.round((Date.now() - startTime) / 1000);
          send({
            status: 'complete',
            processed,
            total,
            successful,
            failed,
            skipped,
            duration,
          });
        } catch (err) {
          send({ status: 'error', message: err.message });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Generate cache error:', error);
    return NextResponse.json({ error: 'Failed to generate cache' }, { status: 500 });
  }
}
