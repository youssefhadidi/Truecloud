/** @format */

// Startup logging
console.error('[WORKER] Starting worker process');

import { resolve, join, extname } from 'node:path';
import fsPromises from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

console.error('[WORKER] Core modules imported');

import { readThumbnailConfig } from '../thumbnailConfig.mjs';
import { thumbnailKey } from '../thumbnailKey.mjs';

console.error('[WORKER] Thumbnail config imported');

import { Semaphore } from '../semaphore.mjs';

console.error('[WORKER] Semaphore imported');

// Import shared extension constants
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS, THUMBNAIL_EXTENSIONS, OPTIMIZE_EXTENSIONS, STREAM_EXTENSIONS } from '../extensions.mjs';

import {
  buildHlsArgs,
  isNativelyPlayable,
  willStreamCopy,
  defaultHwaccel,
  readPrefetchedSegments,
  prefetchMarkerContent,
  HLS_SEG_DURATION,
  PREFETCH_MARKER,
  PREFETCH_PLAYLIST,
} from '../hlsEncode.mjs';
import { readTranscodingConfig } from '../transcodingConfig.mjs';

// Number of HLS segments to pre-generate during cache build (each ~4 s).
// Set to 0 to pre-generate the full video. Default: 3 segments (≈12 s).
const STREAM_PREFETCH_SEGMENTS = parseInt(process.env.STREAM_PREFETCH_SEGMENTS || '3', 10);

console.error('[WORKER] Extensions imported - all modules loaded successfully');

// Config received from parent process via IPC
let scanDir, targetPath, type, thumbnailDir, optiCacheDir, streamCacheDir, cwd;

// Cancellation support
let cancelRequested = false;
const spawnedProcesses = new Map();

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

const semaphore = new Semaphore(20);

// Send message to parent process via IPC
function send(data) {
  process.send(data);
}

// Kill all spawned external processes
function killSpawnedProcesses() {
  for (const [processId, proc] of spawnedProcesses.entries()) {
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      console.error(`[WORKER] Failed to kill process ${processId}:`, err.message);
    }
    spawnedProcesses.delete(processId);
  }
}

// Cache sharp import so it's resolved once
let _sharp;
async function getSharp() {
  if (!_sharp) {
    _sharp = (await import('sharp')).default;
    // Limit sharp's internal libuv thread pool to avoid native crashes under
    // heavy concurrent load (Bun + libvips segfault with too many threads).
    _sharp.concurrency(1);
  }
  return _sharp;
}

/**
 * Run `produce(tmpPath)`, then move the result to `finalPath` in one rename.
 *
 * Every reader treats "the thumbnail file exists" as "the thumbnail is done".
 * Writing in place let a request that arrived mid-generation (from the app,
 * which this worker process can't coordinate with) or after a crash mid-write serve a
 * truncated image — and then keep it in the memory cache and the browser's.
 * The temp name keeps the .webp extension because ffmpeg picks its output
 * format from it.
 */
// Mirrors writeAtomically in lib/thumbnailUtils.js, which this worker can't
// import (it resolves '@/' aliases).
async function writeAtomically(finalPath, produce) {
  const tmpPath = finalPath.replace(/\.webp$/, `.${process.pid}-${randomBytes(4).toString('hex')}.tmp.webp`);
  try {
    await produce(tmpPath);
    await fsPromises.rename(tmpPath, finalPath);
  } catch (err) {
    await fsPromises.unlink(tmpPath).catch(() => {});
    throw err;
  }
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
        // Size and mtime feed the thumbnail and HLS cache keys.
        const { size, mtimeMs } = await fsPromises.stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          relativePath: basePath,
          fullRelativePath: relativePath,
          size,
          mtimeMs,
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
  const thumbnailFileName = `${thumbnailKey(file.name, file.size)}.webp`;
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
      await writeAtomically(thumbnailPath, (tmpPath) =>
        sharp(file.path, { failOn: 'none', failOnError: false, limitInputPixels: false })
          .rotate()
          .resize(config.size, config.size, { fit: 'inside' })
          .webp({ quality: config.quality })
          .toFile(tmpPath),
      );
      return { success: true };
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      await writeAtomically(thumbnailPath, (tmpPath) => generateVideoThumbnail(file.path, tmpPath, config, 30000));
      return { success: true };
    } else if (PDF_EXTENSIONS.includes(ext)) {
      await writeAtomically(thumbnailPath, async (tmpPath) => {
        try {
          await generatePdfThumbnail(file.path, tmpPath, config);
        } finally {
          await fsPromises.unlink(tmpPath.replace(/\.webp$/, '.jpg')).catch(() => {});
        }
      });
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }

  return { skipped: true, reason: 'unsupported' };
}

// Generate video thumbnail using FFmpeg
function generateVideoThumbnail(filePath, thumbnailPath, config, timeoutMs = 20000) {
  // Check if cancellation was requested before spawning
  if (cancelRequested) {
    return Promise.resolve({ skipped: true, reason: 'cancelled' });
  }

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
    const processId = `ffmpeg-${Date.now()}-${Math.random()}`;
    spawnedProcesses.set(processId, ffmpeg);
    let errorOutput = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      spawnedProcesses.delete(processId);
      reject(new Error(`FFmpeg timeout after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      spawnedProcesses.delete(processId);
      if (timedOut) return;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      spawnedProcesses.delete(processId);
      if (timedOut) return;
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// Generate PDF thumbnail using Ghostscript + Sharp
function generatePdfThumbnail(filePath, thumbnailPath, config, timeoutMs = 60000) {
  // Check if cancellation was requested before spawning
  if (cancelRequested) {
    return Promise.resolve({ skipped: true, reason: 'cancelled' });
  }

  const jpgPath = thumbnailPath.replace(/\.webp$/, '.jpg');

  const gsArgs = ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=jpeg', '-dFirstPage=1', '-dLastPage=1', '-r72', `-sOutputFile=${jpgPath}`, filePath];

  return new Promise((resolve, reject) => {
    const gs = spawn('gs', gsArgs);
    const processId = `gs-${Date.now()}-${Math.random()}`;
    spawnedProcesses.set(processId, gs);
    let errorOutput = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      gs.kill();
      spawnedProcesses.delete(processId);
      reject(new Error(`Ghostscript timeout after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    gs.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gs.on('close', async (code) => {
      clearTimeout(timeout);
      spawnedProcesses.delete(processId);
      if (timedOut) return;

      if (code !== 0) {
        reject(new Error(`Ghostscript exited with code ${code}: ${errorOutput}`));
        return;
      }

      try {
        const sharp = await getSharp();
        await sharp(jpgPath).resize(config.size, config.size, { fit: 'inside' }).webp({ quality: config.quality }).toFile(thumbnailPath);
        resolve();
      } catch (error) {
        reject(new Error(`Sharp conversion failed: ${error.message}`));
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      spawnedProcesses.delete(processId);
      if (timedOut) return;
      reject(new Error('Ghostscript is not installed or not in PATH'));
    });
  });
}

// Generate optimized image for a single file
async function generateOptimized(file) {
  // Check if cancellation was requested before processing
  if (cancelRequested) {
    return { skipped: true, reason: 'cancelled' };
  }

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
    await writeAtomically(cachedPath, (tmpPath) =>
      sharp(file.path, { failOn: 'none', failOnError: false, limitInputPixels: false })
        .rotate()
        .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(tmpPath),
    );

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Probe codecs in a media file using ffprobe
async function probeCodecs(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath,
    ]);

    let stdout = '';
    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    const empty = { videoCodec: null, audioCodec: null, videoHeight: null, pixFmt: null };

    const timer = setTimeout(() => {
      ffprobe.kill();
      resolve(empty);
    }, 10000);

    ffprobe.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const data = JSON.parse(stdout);
          const videoStream = data.streams?.find((s) => s.codec_type === 'video');
          const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
          resolve({
            videoCodec: videoStream?.codec_name?.toLowerCase() ?? null,
            audioCodec: audioStream?.codec_name?.toLowerCase() ?? null,
            videoHeight: videoStream?.height ?? null,
            pixFmt: videoStream?.pix_fmt?.toLowerCase() ?? null,
          });
        } catch {
          resolve(empty);
        }
      } else {
        resolve(empty);
      }
    });

    ffprobe.on('error', () => {
      clearTimeout(timer);
      resolve(empty);
    });
  });
}

// Must match getHlsHash in lib/hlsManager.js, or the on-demand job never
// finds what this worker pre-generated.
function hlsHash(file) {
  return createHash('md5').update(`${file.path}|${file.size}|${file.mtimeMs}`).digest('hex');
}

async function isHlsComplete(hlsDir) {
  try {
    const content = await fsPromises.readFile(join(hlsDir, 'index.m3u8'), 'utf8');
    return content.includes('#EXT-X-ENDLIST');
  } catch {
    return false;
  }
}

// Generate HLS stream cache for a single file.
// When STREAM_PREFETCH_SEGMENTS > 0 only the first N segments are generated
// (partial pre-cache), and PREFETCH_MARKER records them; the on-demand job
// then starts encoding after them (see readPrefetchedSegments in hlsEncode.mjs).
// Encoded with exactly the on-demand job's settings — same encoder choice, same
// maxHeight, same args — because these segments play in the same stream.
async function generateStream(file) {
  const ext = extname(file.name).toLowerCase();

  if (!STREAM_EXTENSIONS.includes(ext)) {
    return { skipped: true, reason: 'not-streamable' };
  }

  const pathHash = hlsHash(file);
  const hlsDir = join(resolve(cwd, streamCacheDir), 'hls', pathHash);
  const { maxHeight } = await readTranscodingConfig();

  if (await isHlsComplete(hlsDir)) {
    return { skipped: true, reason: 'exists' };
  }

  // Already pre-cached under the current settings; on-demand will do the rest
  if (STREAM_PREFETCH_SEGMENTS > 0 && (await readPrefetchedSegments(hlsDir, maxHeight)) > 0) {
    return { skipped: true, reason: 'prefetched' };
  }

  if (cancelRequested) {
    return { skipped: true, reason: 'cancelled' };
  }

  const codecs = await probeCodecs(file.path);

  // Served directly by the stream route, no HLS cache needed.
  if (isNativelyPlayable(ext, codecs)) {
    return { skipped: true, reason: 'native-streamable' };
  }

  const partial = STREAM_PREFETCH_SEGMENTS > 0;

  // A remux runs many times faster than realtime, and its segments split at
  // the source's own keyframes, so the on-demand job cannot start after them
  // — it would redo the pre-cached ones from 0 anyway.
  if (partial && willStreamCopy(codecs.videoCodec, { maxHeight, sourceHeight: codecs.videoHeight })) {
    return { skipped: true, reason: 'stream-copy' };
  }

  await fsPromises.mkdir(hlsDir, { recursive: true });

  // Partial runs write their own playlist. index.m3u8 is the on-demand job's,
  // and a truncated run would stamp it #EXT-X-ENDLIST — reading as a finished
  // transcode of the whole video.
  const m3u8Path = join(hlsDir, partial ? PREFETCH_PLAYLIST : 'index.m3u8');
  const buildArgs = (hwaccel) =>
    buildHlsArgs(file.path, m3u8Path, codecs.videoCodec, codecs.audioCodec, hwaccel, {
      maxHeight,
      sourceHeight: codecs.videoHeight,
      pixFmt: codecs.pixFmt,
      maxSecs: partial ? STREAM_PREFETCH_SEGMENTS * HLS_SEG_DURATION : undefined,
    });

  const hwaccel = defaultHwaccel();
  let result = await new Promise((res) => spawnAndWaitHls(buildArgs(hwaccel), hlsDir, res));
  // Same fallback as the on-demand job: any VAAPI failure retries in software.
  if (!result.success && hwaccel === 'vaapi' && !cancelRequested) {
    result = await new Promise((res) => spawnAndWaitHls(buildArgs('none'), hlsDir, res));
  }

  if (result.success && partial) {
    // Count what was written instead of trusting the request: -t can leave a
    // sliver of a trailing segment, and a marker claiming one segment too many
    // would have the on-demand job start past a gap.
    const playlist = await fsPromises.readFile(m3u8Path, 'utf8').catch(() => '');
    const written = playlist.split('\n').filter((line) => /^seg\d+\.ts$/.test(line.trim())).length;
    const segments = Math.min(written, STREAM_PREFETCH_SEGMENTS);
    if (segments > 0) {
      await fsPromises
        .writeFile(join(hlsDir, PREFETCH_MARKER), prefetchMarkerContent({ segments, maxHeight }), 'utf8')
        .catch(() => {});
    }
  }
  return result;
}

// Helper to spawn FFmpeg for HLS generation and wait for completion
// cwd must be hlsDir so that seg%03d.ts segments are written to the right place
function spawnAndWaitHls(ffmpegArgs, hlsDir, resolve) {
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { cwd: hlsDir });
  const processId = `ffmpeg-hls-${Date.now()}-${Math.random()}`;
  spawnedProcesses.set(processId, ffmpeg);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    ffmpeg.kill();
    spawnedProcesses.delete(processId);
    resolve({ success: false, error: 'FFmpeg HLS timeout (10 min)' });
  }, 600000);

  ffmpeg.on('close', (code) => {
    clearTimeout(timeout);
    spawnedProcesses.delete(processId);
    if (timedOut) return;
    resolve(code === 0 ? { success: true } : { success: false, error: `FFmpeg HLS exited with code ${code}` });
  });

  ffmpeg.on('error', (err) => {
    clearTimeout(timeout);
    spawnedProcesses.delete(processId);
    if (timedOut) return;
    resolve({ success: false, error: err.message });
  });
}

// Check if thumbnail needs to be generated (before acquiring semaphore)
async function thumbnailNeedsGeneration(file) {
  const thumbnailPath = join(resolve(cwd, thumbnailDir), `${thumbnailKey(file.name, file.size)}.webp`);
  try {
    const stats = await fsPromises.stat(thumbnailPath);
    return !stats.isFile();
  } catch {
    return true;
  }
}

// Check if optimized image needs to be generated (before acquiring semaphore)
async function optimizedNeedsGeneration(file) {
  const cachedPath = join(resolve(cwd, optiCacheDir), `${file.md5}.webp`);
  try {
    const stats = await fsPromises.stat(cachedPath);
    return !stats.isFile();
  } catch {
    return true;
  }
}

// Check if stream cache needs to be generated (before acquiring semaphore)
async function streamNeedsGeneration(file) {
  const hlsDir = join(resolve(cwd, streamCacheDir), 'hls', hlsHash(file));

  // Fully transcoded — no work needed
  if (await isHlsComplete(hlsDir)) return false;

  // Pre-cached under the current settings — on-demand will do the rest. A
  // marker from older args or another maxHeight reads as 0 and is redone.
  if (STREAM_PREFETCH_SEGMENTS > 0) {
    const { maxHeight } = await readTranscodingConfig();
    return (await readPrefetchedSegments(hlsDir, maxHeight)) === 0;
  }
  return true;
}

// Process a single file with semaphore
async function processFile(file, counters) {
  // Check if cancellation was requested before processing
  if (cancelRequested) {
    return;
  }

  // Check if we actually need to generate BEFORE acquiring semaphore
  let needsGeneration = false;
  try {
    if (file.generateType === 'thumbnail') {
      needsGeneration = await thumbnailNeedsGeneration(file);
    } else if (file.generateType === 'optimized') {
      needsGeneration = await optimizedNeedsGeneration(file);
    } else if (file.generateType === 'stream') {
      needsGeneration = await streamNeedsGeneration(file);
    }
  } catch (err) {
    // If check fails, assume we need to generate
    needsGeneration = true;
  }

  // Skip without acquiring semaphore if not needed
  if (!needsGeneration) {
    counters.processed++;
    counters.skipped++;
    return;
  }

  // Video transcoding is by far the most expensive operation — each ffmpeg
  // encode can consume 1–4 GB of RAM and max out multiple CPU cores.
  // Use weight 10 (semaphore=20) so at most 2 concurrent video transcodes run.
  // HEIC images are next most expensive at weight 4 (~5 concurrent).
  const ext = extname(file.name).toLowerCase();
  let weight = 1;
  if (file.generateType === 'stream') weight = 10;
  else if (ext === '.heic') weight = 4;

  await semaphore.acquire(weight);

  try {
    // Check again after acquiring semaphore
    if (cancelRequested) {
      return;
    }

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

    // Don't send progress updates if cancellation is pending
    if (!cancelRequested) {
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
    }
  } catch (err) {
    counters.processed++;
    counters.failed++;

    // Don't send progress updates if cancellation is pending
    if (!cancelRequested) {
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
    }
  } finally {
    semaphore.release(weight);
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
    // Use Promise.allSettled to ensure all pending promises complete even if one errors
    const filePromises = eligibleFiles.map((file) => processFile(file, counters));
    await Promise.allSettled(filePromises);

    // Check if cancellation was requested
    if (cancelRequested) {
      console.error('[WORKER] Processing was cancelled');
      send({
        status: 'cancelled',
        processed: counters.processed,
        total,
        successful: counters.successful,
        failed: counters.failed,
        skipped: counters.skipped,
      });
      return;
    }

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

process.on('message', (message) => {
  // Handle cancel message
  if (message.type === 'cancel') {
    console.error('[WORKER] Cancel message received');
    cancelRequested = true;
    killSpawnedProcesses();
    return;
  }

  // Handle config message (initial startup)
  console.error('[WORKER] Received config:', Object.keys(message));
  ({ scanDir, targetPath, type, thumbnailDir, optiCacheDir, streamCacheDir, cwd } = message);
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
