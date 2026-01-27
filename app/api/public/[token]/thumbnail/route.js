/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { getOrConvertHeicToJpeg } from '@/lib/heicUtils';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = process.env.HEIC_DIR || './heic';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export const maxDuration = 60;

// Semaphore for limiting concurrent generation
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
    return new Promise((resolve) => this.queue.push(resolve));
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

const thumbnailSemaphore = new Semaphore(10);

async function generateImageThumbnail(filePathOrBuffer, thumbnailPath) {
  const sharp = (await import('sharp')).default;
  await sharp(filePathOrBuffer, { failOnError: false, limitInputPixels: false })
    .resize(150, 150, { fit: 'inside' })
    .webp({ quality: 80 })
    .toFile(thumbnailPath);
}

async function generateVideoThumbnail(filePath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-threads',
      '1',
      '-ss',
      '00:00:01.000',
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=200:200:force_original_aspect_ratio=decrease:flags=fast_bilinear',
      '-q:v',
      '80',
      thumbnailPath,
    ]);

    const timeout = setTimeout(() => {
      ffmpeg.kill();
      reject(new Error('FFmpeg timeout'));
    }, 20000);

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed with code ${code}`));
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function generateHeicThumbnail(filePath, thumbnailPath, fileId) {
  const cachedJpegPath = await getOrConvertHeicToJpeg(filePath, fileId);
  const sharp = (await import('sharp')).default;
  await sharp(cachedJpegPath, { failOnError: false, limitInputPixels: false })
    .resize(200, 200, { fit: 'inside' })
    .webp({ quality: 80 })
    .toFile(thumbnailPath);
}

async function generatePdfThumbnail(filePath, thumbnailPath) {
  const jpgPath = thumbnailPath.replace('.webp', '.jpg');

  return new Promise((resolve, reject) => {
    const gs = spawn('gs', [
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
    ]);

    const timeout = setTimeout(() => {
      gs.kill();
      reject(new Error('Ghostscript timeout'));
    }, 60000);

    gs.on('close', async (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Ghostscript failed with code ${code}`));
        return;
      }

      try {
        const sharp = (await import('sharp')).default;
        await sharp(jpgPath).resize(200, 200, { fit: 'inside' }).webp({ quality: 90 }).toFile(thumbnailPath);
        await fsPromises.unlink(jpgPath);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

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

    // Get optional file param for directory shares
    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

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

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const heicDir = resolve(process.cwd(), HEIC_DIR);
    const thumbnailsDir = resolve(process.cwd(), THUMBNAIL_DIR);
    const streamCacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);

    // Try HEIC directory first, then uploads
    let filePath = join(heicDir, pathCheck.fullPath);
    try {
      await fsPromises.access(filePath);
    } catch {
      filePath = join(uploadsDir, pathCheck.fullPath);
    }

    // Check file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Security check
    const resolvedPath = resolve(filePath) + sep;
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR) && !resolvedPath.startsWith(resolve(process.cwd(), HEIC_DIR) + sep)) {
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

    const imageExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png', '.webp', '.svg', '.ico'];
    const heicExtensions = ['.heic', '.heif'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
    const pdfExtensions = ['.pdf'];

    const isImage = imageExtensions.includes(fileExt);
    const isHeic = heicExtensions.includes(fileExt);
    const isVideo = videoExtensions.includes(fileExt);
    const isPdf = pdfExtensions.includes(fileExt);

    if (!isImage && !isHeic && !isVideo && !isPdf) {
      return NextResponse.json({ error: 'Thumbnail not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail path
    const thumbnailFileName = `public_${token}_${fileName.replace(/[/\\]/g, '_')}.webp`;
    const thumbnailPath = join(thumbnailsDir, thumbnailFileName);

    await fsPromises.mkdir(thumbnailsDir, { recursive: true });

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
        } else if (isHeic) {
          await generateHeicThumbnail(filePath, thumbnailPath, fileName);
        } else if (isVideo) {
          await generateVideoThumbnail(filePath, thumbnailPath);
        } else {
          const sharp = (await import('sharp')).default;
          try {
            let sharpInstance = sharp(filePath, { failOnError: false, limitInputPixels: false });
            const metadata = await sharpInstance.metadata();

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

            if (rotation) {
              if (rotation.rotate) sharpInstance = sharpInstance.rotate(rotation.rotate);
              if (rotation.flip) sharpInstance = sharpInstance.flip();
              if (rotation.flop) sharpInstance = sharpInstance.flop();
            }

            const buffer = await sharpInstance.toBuffer();
            await generateImageThumbnail(buffer, thumbnailPath);
          } catch {
            await generateImageThumbnail(filePath, thumbnailPath);
          }
        }
      } catch (error) {
        return NextResponse.json({ error: 'Thumbnail generation failed', details: error.message }, { status: 500 });
      } finally {
        thumbnailSemaphore.release();
      }
    }

    // Return base64 thumbnail
    const thumbnailBuffer = await fsPromises.readFile(thumbnailPath);
    const base64 = thumbnailBuffer.toString('base64');
    const dataUrl = `data:image/webp;base64,${base64}`;

    return NextResponse.json({ data: dataUrl, generated: !thumbnailExists });
  } catch (error) {
    console.error('GET /api/public/[token]/thumbnail - Error:', error);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
