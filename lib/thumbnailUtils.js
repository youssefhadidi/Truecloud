/** @format */

import { spawn } from 'child_process';
import fsPromises from 'fs/promises';

// Thumbnail configuration from environment variables
export const THUMBNAIL_SIZE = parseInt(process.env.THUMBNAIL_SIZE, 10) || 200;
export const THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY, 10) || 75;

/**
 * Generate an image thumbnail using Sharp.
 * Handles all image formats including HEIC/HEIF natively (sharp 0.33+).
 * Auto-applies EXIF orientation via .rotate().
 * @param {string|Buffer} filePathOrBuffer - File path or buffer to process
 * @param {string} thumbnailPath - Output path for the thumbnail
 */
export async function generateImageThumbnail(filePathOrBuffer, thumbnailPath) {
  const sharp = (await import('sharp')).default;
  await sharp(filePathOrBuffer, { failOnError: false, limitInputPixels: false })
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside' })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toFile(thumbnailPath);
}

/**
 * Generate a video thumbnail using FFmpeg.
 * @param {string} filePath - Path to the video file
 * @param {string} thumbnailPath - Output path for the thumbnail
 * @param {number} [timeoutMs=20000] - Timeout in milliseconds
 */
export async function generateVideoThumbnail(filePath, thumbnailPath, timeoutMs = 20000) {
  const ffmpegArgs = [
    '-y',
    '-threads',
    '1',
    '-ss',
    '00:00:01.000',
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=decrease:flags=fast_bilinear`,
    '-q:v',
    String(THUMBNAIL_QUALITY),
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
        const sharp = (await import('sharp')).default;
        await sharp(jpgPath).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside' }).webp({ quality: THUMBNAIL_QUALITY }).toFile(thumbnailPath);
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
