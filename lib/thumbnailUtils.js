/** @format */

import { spawn } from 'child_process';
import fsPromises from 'fs/promises';
import { resolve, join, extname } from 'node:path';
import { readThumbnailConfig } from '@/lib/thumbnailConfig';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS } from '@/lib/extensions';
import { thumbnailKey } from '@/lib/thumbnailKey.mjs';

// Cache sharp import so it's resolved once, and pin libvips to a single
// internal thread. Under Bun + libheif, default thread counts (= CPU count)
// multiplied by concurrent calls produce native segfaults; keeping libvips
// single-threaded mirrors what the cache worker does (generateCacheWorker.mjs).
let _sharp;
async function getSharp() {
  if (!_sharp) {
    _sharp = (await import('sharp')).default;
    _sharp.concurrency(1);
  }
  return _sharp;
}

/**
 * Generate an image thumbnail using Sharp.
 * Handles all image formats including HEIC/HEIF natively (sharp 0.33+).
 * Auto-applies EXIF orientation via .rotate().
 * @param {string|Buffer} filePathOrBuffer - File path or buffer to process
 * @param {string} thumbnailPath - Output path for the thumbnail
 */
export async function generateImageThumbnail(filePathOrBuffer, thumbnailPath) {
  const { size, quality } = await readThumbnailConfig();
  const sharp = await getSharp();
  await sharp(filePathOrBuffer, { failOn: 'none', failOnError: false, limitInputPixels: false })
    .rotate()
    .resize(size, size, { fit: 'inside' })
    .webp({ quality })
    .toFile(thumbnailPath);
}

/**
 * Get video duration using ffprobe.
 * @param {string} filePath - Path to the video file
 * @returns {Promise<number>} Duration in seconds
 */
async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1:noprint_wrappers=1',
      filePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 1 : duration);
      } else {
        // Default to 1 second if ffprobe fails
        resolve(1);
      }
    });

    ffprobe.on('error', () => {
      // Default to 1 second if ffprobe not available
      resolve(1);
    });
  });
}

/**
 * Generate a video thumbnail using FFmpeg.
 * Captures the middle frame of the video for better representation.
 * @param {string} filePath - Path to the video file
 * @param {string} thumbnailPath - Output path for the thumbnail
 * @param {number} [timeoutMs=20000] - Timeout in milliseconds
 */
export async function generateVideoThumbnail(filePath, thumbnailPath, timeoutMs = 20000) {
  const { size, quality } = await readThumbnailConfig();

  // Get video duration to extract middle frame
  const duration = await getVideoDuration(filePath);
  const middleTime = Math.floor(duration / 2);

  // Convert seconds to HH:MM:SS.000 format
  const hours = Math.floor(middleTime / 3600);
  const minutes = Math.floor((middleTime % 3600) / 60);
  const seconds = middleTime % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.000`;

  const ffmpegArgs = [
    '-y',
    '-threads',
    '1',
    '-ss',
    timeStr,
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=fast_bilinear`,
    '-q:v',
    String(quality),
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      reject(new Error(`FFmpeg timeout after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Generate a PDF thumbnail using Ghostscript + Sharp.
 * @param {string} filePath - Path to the PDF file
 * @param {string} thumbnailPath - Output path for the thumbnail (.webp)
 * @param {number} [timeoutMs=60000] - Timeout in milliseconds
 */
export async function generatePdfThumbnail(filePath, thumbnailPath, timeoutMs = 60000) {
  const { size, quality } = await readThumbnailConfig();
  const jpgPath = thumbnailPath.replace('.webp', '.jpg');

  const gsArgs = ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=jpeg', '-dFirstPage=1', '-dLastPage=1', '-r150', `-sOutputFile=${jpgPath}`, filePath];

  return new Promise((resolve, reject) => {
    const gs = spawn('gs', gsArgs);
    let errorOutput = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      gs.kill();
      reject(new Error(`Ghostscript timeout after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    gs.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gs.on('close', async (code) => {
      clearTimeout(timeout);
      if (timedOut) return;

      if (code !== 0) {
        reject(new Error(`Ghostscript exited with code ${code}: ${errorOutput}`));
        return;
      }

      try {
        const sharp = await getSharp();
        await sharp(jpgPath).resize(size, size, { fit: 'inside' }).webp({ quality }).toFile(thumbnailPath);
        await fsPromises.unlink(jpgPath);
        resolve();
      } catch (error) {
        reject(new Error(`Sharp conversion failed: ${error.message}`));
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      reject(new Error('Ghostscript is not installed or not in PATH. Install it with: sudo apt-get install ghostscript'));
    });
  });
}

const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';

/**
 * Fire-and-forget thumbnail generation triggered right after an upload finishes.
 * Mirrors the filename scheme used by the on-demand thumbnail route so a later
 * GET /api/files/thumbnail/[id] finds the cached file instead of regenerating.
 * Errors are swallowed (only logged) — failing to build a thumbnail must not
 * surface as an upload failure.
 */
export function generateThumbnailForUpload(filePath, relativePath, fileName) {
  const ext = extname(fileName).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.includes(ext);
  const isVideo = VIDEO_EXTENSIONS.includes(ext);
  const isPdf = PDF_EXTENSIONS.includes(ext);

  if (!isImage && !isVideo && !isPdf) return;

  const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);

  (async () => {
    try {
      // Key on name+size (path-independent) so the on-demand thumbnail route
      // finds this pre-generated file even after the folder is renamed/moved.
      const { size } = await fsPromises.stat(filePath);
      const thumbnailFileName = `${thumbnailKey(fileName, size)}.webp`;
      const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

      await fsPromises.mkdir(thumbnailsDir, { recursive: true });

      try {
        await fsPromises.stat(thumbnailPath);
        return;
      } catch {}

      if (isImage) {
        await generateImageThumbnail(filePath, thumbnailPath);
      } else if (isVideo) {
        await generateVideoThumbnail(filePath, thumbnailPath);
      } else {
        await generatePdfThumbnail(filePath, thumbnailPath);
      }
    } catch (error) {
      try {
        const { logger } = await import('@/lib/logger');
        logger.warn('generateThumbnailForUpload - failed', {
          filePath,
          relativePath,
          fileName,
          error: error?.message,
        });
      } catch {
        console.warn('generateThumbnailForUpload - failed', filePath, error?.message);
      }
    }
  })();
}
