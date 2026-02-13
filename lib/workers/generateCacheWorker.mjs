/** @format */

// Startup logging
console.error('[WORKER] Starting worker process');

import { resolve, join, extname } from 'node:path';
import fsPromises from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

console.error('[WORKER] Core modules imported');

import { readThumbnailConfig } from '../thumbnailConfig.js';

console.error('[WORKER] Thumbnail config imported');

import { Semaphore } from '../semaphore.js';

console.error('[WORKER] Semaphore imported');

// Import shared extension constants
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS, THUMBNAIL_EXTENSIONS, OPTIMIZE_EXTENSIONS, STREAM_EXTENSIONS } from '../extensions.js';

console.error('[WORKER] Extensions imported - all modules loaded successfully');

// Config received from parent process via IPC
let scanDir, targetPath, type, thumbnailDir, optiCacheDir, streamCacheDir, cwd;

const CONFIG_TTL_MS = 5000;
let cachedThumbnailConfig = null;
let cachedThumbnailConfigAt = 0;

async function getThumbnailConfig() {
  const now = Date.now();
  if (cachedThumbnailConfig && now - cachedThumbnailConfigAt < CONFIG_TTL_MS) {
    return cachedThumbnailConfig;
  }
  cachedThumbnailConfig = await readThumbnailConfig();
  cachedThumbnailConfigAt = now;
  return cachedThumbnailConfig;
}

const semaphore = new Semaphore(10);

// Send message to parent process via IPC
function send(data) {
  process.send(data);
}

// Cache sharp import so it's resolved once
let _sharp;
async function getSharp() {
  if (!_sharp) _sharp = (await import('sharp')).default;
  return _sharp;
}

// Scan directory recursively
async function scanDirectory(dirPath, basePath = '') {
  const files = [];

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
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
  const thumbnailsDir = resolve(cwd, thumbnailDir);
  const thumbnailFileName = `${file.relativePath.replace(/[/\\]/g, '_')}_${file.name}.webp`;
  const thumbnailPath = join(thumbnailsDir, thumbnailFileName);
  const config = await getThumbnailConfig();

  try {
    await fsPromises.stat(thumbnailPath);
    return { skipped: true, reason: 'exists' };
  } catch {
    // Doesn't exist
  }

  try {
    if (IMAGE_EXTENSIONS.includes(ext)) {
      const sharp = await getSharp();
      await sharp(file.path, { failOn: 'none', failOnError: false, limitInputPixels: false })
        .rotate()
        .resize(config.size, config.size, { fit: 'inside' })
        .webp({ quality: config.quality })
        .toFile(thumbnailPath);
      return { success: true };
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      await generateVideoThumbnail(file.path, thumbnailPath, config, 30000);
      return { success: true };
    } else if (PDF_EXTENSIONS.includes(ext)) {
      await generatePdfThumbnail(file.path, thumbnailPath, config);
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }

  return { skipped: true, reason: 'unsupported' };
}

// Generate video thumbnail using FFmpeg
function generateVideoThumbnail(filePath, thumbnailPath, config, timeoutMs = 20000) {
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
    `scale=${config.size}:${config.size}:force_original_aspect_ratio=decrease:flags=fast_bilinear`,
    '-q:v',
    String(config.quality),
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

// Generate PDF thumbnail using Ghostscript + Sharp
function generatePdfThumbnail(filePath, thumbnailPath, config, timeoutMs = 60000) {
  const jpgPath = thumbnailPath.replace('.webp', '.jpg');

  const gsArgs = ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=jpeg', '-dFirstPage=1', '-dLastPage=1', '-r72', `-sOutputFile=${jpgPath}`, filePath];

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
        await sharp(jpgPath).resize(config.size, config.size, { fit: 'inside' }).webp({ quality: config.quality }).toFile(thumbnailPath);
        await fsPromises.unlink(jpgPath);
        resolve();
      } catch (error) {
        reject(new Error(`Sharp conversion failed: ${error.message}`));
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      reject(new Error('Ghostscript is not installed or not in PATH'));
    });
  });
}

// Generate optimized image for a single file
async function generateOptimized(file) {
  const ext = extname(file.name).toLowerCase();

  // Skip non-optimizable
  if (!OPTIMIZE_EXTENSIONS.includes(ext)) {
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
  const cacheDir = resolve(cwd, optiCacheDir, file.relativePath);
  const cachedPath = join(cacheDir, `${cacheKey}.webp`);

  try {
    await fsPromises.stat(cachedPath);
    return { skipped: true, reason: 'exists' };
  } catch {
    // Doesn't exist
  }

  await fsPromises.mkdir(cacheDir, { recursive: true });

  const sharp = await getSharp();

  try {
    await sharp(file.path, { failOn: 'none', failOnError: false, limitInputPixels: false })
      .rotate()
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toFile(cachedPath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Generate stream-optimized MP4
async function generateStream(file) {
  const ext = extname(file.name).toLowerCase();

  if (!STREAM_EXTENSIONS.includes(ext)) {
    return { skipped: true, reason: 'not-mp4' };
  }

  const pathHash = createHash('md5').update(file.path).digest('hex');
  const cacheDir = resolve(cwd, streamCacheDir);
  const cachedPath = join(cacheDir, `${pathHash}.mp4`);

  try {
    const [sourceStats, cachedStats] = await Promise.all([fsPromises.stat(file.path), fsPromises.stat(cachedPath)]);
    if (cachedStats.mtime >= sourceStats.mtime) {
      return { skipped: true, reason: 'exists' };
    }
  } catch {
    // Cache doesn't exist
  }

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-i', file.path, '-c:v', 'copy', '-c:a', 'copy', '-movflags', 'faststart', '-y', cachedPath]);

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      resolve({ success: false, error: 'FFmpeg timeout (5 min)' });
    }, 300000);

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

// Process a single file with semaphore
async function processFile(file, counters) {
  await semaphore.acquire();

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

    counters.processed++;

    if (result.skipped) {
      counters.skipped++;
    } else if (result.success) {
      counters.successful++;
    } else {
      counters.failed++;
    }

    send({
      status: 'progress',
      processed: counters.processed,
      total: counters.total,
      successful: counters.successful,
      failed: counters.failed,
      skipped: counters.skipped,
      current: file.name,
      type: file.generateType,
    });
  } catch (err) {
    counters.processed++;
    counters.failed++;

    send({
      status: 'progress',
      processed: counters.processed,
      total: counters.total,
      successful: counters.successful,
      failed: counters.failed,
      skipped: counters.skipped,
      current: file.name,
      type: file.generateType,
      error: err.message,
    });
  } finally {
    semaphore.release();
  }
}

// Main execution
async function main() {
  try {
    console.error('[WORKER] Main function starting');
    send({ status: 'scanning', message: 'Scanning directory...' });
    const allFiles = await scanDirectory(scanDir, targetPath);

    // Filter files based on type
    let eligibleFiles = [];
    if (type === 'thumbnails' || type === 'both' || type === 'all') {
      const thumbFiles = allFiles.filter((f) => {
        const ext = extname(f.name).toLowerCase();
        return THUMBNAIL_EXTENSIONS.includes(ext);
      });
      eligibleFiles.push(...thumbFiles.map((f) => ({ ...f, generateType: 'thumbnail' })));
    }
    if (type === 'optimized' || type === 'both' || type === 'all') {
      const optFiles = allFiles.filter((f) => {
        const ext = extname(f.name).toLowerCase();
        return OPTIMIZE_EXTENSIONS.includes(ext);
      });
      eligibleFiles.push(...optFiles.map((f) => ({ ...f, generateType: 'optimized' })));
    }
    if (type === 'stream' || type === 'all') {
      const streamFiles = allFiles.filter((f) => {
        const ext = extname(f.name).toLowerCase();
        return STREAM_EXTENSIONS.includes(ext);
      });
      eligibleFiles.push(...streamFiles.map((f) => ({ ...f, generateType: 'stream' })));
    }

    const total = eligibleFiles.length;
    send({ status: 'starting', total, message: `Found ${total} files to process` });

    // Pre-create output directories once
    await Promise.all([
      fsPromises.mkdir(resolve(cwd, thumbnailDir), { recursive: true }),
      fsPromises.mkdir(resolve(cwd, optiCacheDir), { recursive: true }),
      fsPromises.mkdir(resolve(cwd, streamCacheDir), { recursive: true }),
    ]);

    const counters = { processed: 0, successful: 0, failed: 0, skipped: 0, total };
    const startTime = Date.now();

    // Process all files in parallel (semaphore limits concurrency to 15)
    await Promise.all(eligibleFiles.map((file) => processFile(file, counters)));

    const duration = Math.round((Date.now() - startTime) / 1000);
    send({
      status: 'complete',
      processed: counters.processed,
      total,
      successful: counters.successful,
      failed: counters.failed,
      skipped: counters.skipped,
      duration,
    });
  } catch (err) {
    console.error('[WORKER] Main function error:', err);
    send({ status: 'error', message: err.message });
  }
}

// Error handling for uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[WORKER] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WORKER] Unhandled rejection:', reason);
  process.exit(1);
});

// Wait for config from parent process, then start
console.error('[WORKER] Waiting for config message...');

process.on('message', (config) => {
  console.error('[WORKER] Received config:', Object.keys(config));
  ({ scanDir, targetPath, type, thumbnailDir, optiCacheDir, streamCacheDir, cwd } = config);
  console.error('[WORKER] Config unpacked, calling main()');
  main()
    .catch((err) => {
      console.error('[WORKER] main() threw error:', err);
      process.exit(1);
    })
    .then(() => {
      console.error('[WORKER] main() completed successfully');
      process.exit(0);
    });
});

console.error('[WORKER] Worker initialization complete, waiting for message');
