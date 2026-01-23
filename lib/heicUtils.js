/** @format */

import { join, resolve } from 'node:path';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';

const HEIC_JPEG_CACHE_DIR = process.env.HEIC_JPEG_CACHE_DIR || './.heic-jpeg-cache';

/**
 * Convert HEIC file to JPEG and cache it using heic-convert library
 * @param {string} filePath - Path to the HEIC file
 * @param {string} fileId - File ID for logging
 * @param {object} logger - Logger instance (optional)
 * @returns {Promise<string>} - Path to cached JPEG file
 */
export async function getOrConvertHeicToJpeg(filePath, fileId = '', logger = null) {
  const startTime = Date.now();
  const pathHash = createHash('md5').update(filePath).digest('hex');
  const cachedJpegPath = join(resolve(process.cwd(), HEIC_JPEG_CACHE_DIR), `${pathHash}.jpg`);

  // Check if we already have the JPEG cached
  try {
    await fsPromises.access(cachedJpegPath);
    if (logger) logger.debug('HEIC JPEG cache hit', { fileId, duration: `${Date.now() - startTime}ms` });
    return cachedJpegPath;
  } catch {
    // Cache miss, need to convert
  }

  // Ensure cache directory exists
  await fsPromises.mkdir(resolve(process.cwd(), HEIC_JPEG_CACHE_DIR), { recursive: true });

  if (logger) logger.debug('Converting HEIC to JPEG for caching using heic-convert library', { fileId });

  try {
    // Use heic-convert library to convert HEIC to JPEG
    const heicConvert = (await import('heic-convert')).default;

    const inputBuffer = await fsPromises.readFile(filePath);
    const jpegBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.9,
    });

    await fsPromises.writeFile(cachedJpegPath, jpegBuffer);

    const duration = Date.now() - startTime;
    if (logger) logger.info('HEIC converted to JPEG and cached', { fileId, duration: `${duration}ms` });
    return cachedJpegPath;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (logger) logger.error('HEIC to JPEG conversion failed', { fileId, error: error.message, duration: `${duration}ms` });
    throw new Error(`HEIC conversion failed: ${error.message}`);
  }
}
