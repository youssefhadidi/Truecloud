/** @format */

// Startup logging
console.error('[WORKER] Starting worker process');

import { resolve, join, extname } from 'node:path';
import fsPromises from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

console.error('[WORKER] Core modules imported');

import { readThumbnailConfig } from '../thumbnailConfig.mjs';

console.error('[WORKER] Thumbnail config imported');

import { Semaphore } from '../semaphore.mjs';

console.error('[WORKER] Semaphore imported');

// Import shared extension constants
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, PDF_EXTENSIONS, THUMBNAIL_EXTENSIONS, OPTIMIZE_EXTENSIONS, STREAM_EXTENSIONS } from '../extensions.mjs';

// ─── Inline HLS arg builder ──────────────────────────────────────────────────
// Cannot import from ffmpegUtils.js because it uses @/lib/logger (Next.js alias
// that doesn't resolve in a plain Node.js worker process).
const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';
const BROWSER_COMPATIBLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

// Number of HLS segments to pre-generate during cache build (each ~4 s).
// Set to 0 to pre-generate the full video. Default: 3 segments (≈12 s).
const STREAM_PREFETCH_SEGMENTS = parseInt(process.env.STREAM_PREFETCH_SEGMENTS || '3', 10);

function isAudioBrowserCompatible(codec) {
  if (!codec) return false;
  if (BROWSER_COMPATIBLE_AUDIO.has(codec)) return true;
  if (codec.startsWith('pcm_')) return true;
  return false;
}

function buildHlsArgs(inputPath, outputM3u8, videoCodec, audioCodec, hwaccel, { maxHeight, prefetchSecs } = {}) {
  const needsAudioTranscode = !isAudioBrowserCompatible(audioCodec);
  const audioArgs = needsAudioTranscode ? ['-c:a', 'aac', '-b:a', '128k'] : ['-c:a', 'copy'];

  // -t limits the output to prefetchSecs seconds (used for partial pre-caching)
  const durationArgs = prefetchSecs ? ['-t', String(prefetchSecs)] : [];

  const hlsTail = [
    ...audioArgs,
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', 'seg%03d.ts',
    ...durationArgs,
    '-y', outputM3u8,
  ];

  const scaleFilter = maxHeight
    ? `scale=w=-2:h=${maxHeight}:force_original_aspect_ratio=decrease`
    : null;

  if (videoCodec === 'h264') {
    if (!scaleFilter) return ['-i', inputPath, '-c:v', 'copy', ...hlsTail];
    return ['-i', inputPath, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
      '-force_key_frames', 'expr:gte(t,n_forced*4)', '-vf', scaleFilter, ...hlsTail];
  }

  if (hwaccel === 'vaapi') {
    const vaapiFilter = scaleFilter ? `${scaleFilter},format=nv12,hwupload` : 'format=nv12,hwupload';
    return ['-vaapi_device', VAAPI_DEVICE, '-i', inputPath, '-vf', vaapiFilter,
      '-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-global_quality', '26', '-idr_interval', '1', ...hlsTail];
  }

  const args = ['-i', inputPath, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-force_key_frames', 'expr:gte(t,n_forced*4)'];
  if (scaleFilter) args.push('-vf', scaleFilter);
  return [...args, ...hlsTail];
}

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

  const jpgPath = thumbnailPath.replace('.webp', '.jpg');

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
        await fsPromises.unlink(jpgPath);
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

    const timer = setTimeout(() => {
      ffprobe.kill();
      resolve({ videoCodec: null, audioCodec: null });
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
          });
        } catch {
          resolve({ videoCodec: null, audioCodec: null });
        }
      } else {
        resolve({ videoCodec: null, audioCodec: null });
      }
    });

    ffprobe.on('error', () => {
      clearTimeout(timer);
      resolve({ videoCodec: null, audioCodec: null });
    });
  });
}

// Generate HLS stream cache for a single file.
// When STREAM_PREFETCH_SEGMENTS > 0 only the first N segments are generated
// (partial pre-cache). On-demand transcoding fills the rest when the user
// plays the video. A `prefetch.done` marker is written so subsequent cache
// generation runs skip files that are already pre-cached.
async function generateStream(file) {
  const ext = extname(file.name).toLowerCase();

  if (!STREAM_EXTENSIONS.includes(ext)) {
    return { skipped: true, reason: 'not-streamable' };
  }

  const pathHash = createHash('md5').update(file.path).digest('hex');
  const hlsDir = join(resolve(cwd, streamCacheDir), 'hls', pathHash);
  const m3u8Path = join(hlsDir, 'index.m3u8');
  const prefetchDone = join(hlsDir, 'prefetch.done');

  // Already fully transcoded
  try {
    const content = await fsPromises.readFile(m3u8Path, 'utf8');
    if (content.includes('#EXT-X-ENDLIST')) {
      return { skipped: true, reason: 'exists' };
    }
  } catch {
    // Not present — fall through
  }

  // Already pre-cached (partial segments generated, on-demand will do the rest)
  try {
    await fsPromises.access(prefetchDone);
    return { skipped: true, reason: 'prefetched' };
  } catch {
    // Not present — need to generate
  }

  if (cancelRequested) {
    return { skipped: true, reason: 'cancelled' };
  }

  const codecs = await probeCodecs(file.path);
  const hwaccel = process.env.HWACCEL?.toLowerCase() === 'vaapi' ? 'vaapi' : 'none';

  // H.264 + browser-compatible audio in an MP4 — served natively by the stream route,
  // no HLS cache needed.
  if (ext === '.mp4' && codecs.videoCodec === 'h264' &&
      isAudioBrowserCompatible(codecs.audioCodec)) {
    return { skipped: true, reason: 'native-mp4' };
  }

  await fsPromises.mkdir(hlsDir, { recursive: true });

  // Partial pre-cache: limit FFmpeg to the first N segments worth of seconds.
  // 0 means generate the full video.
  const prefetchSecs =
    STREAM_PREFETCH_SEGMENTS > 0 ? STREAM_PREFETCH_SEGMENTS * 4 : undefined;

  const ffmpegArgs = buildHlsArgs(file.path, m3u8Path, codecs.videoCodec, codecs.audioCodec, hwaccel, { prefetchSecs });

  return new Promise((res) => {
    spawnAndWaitHls(ffmpegArgs, hlsDir, async (result) => {
      if (result.success && prefetchSecs) {
        // Remove index.m3u8 — FFmpeg wrote it with #EXT-X-ENDLIST for the
        // truncated clip, which would make isHlsCacheComplete() think the full
        // video is ready. The on-demand HLS job will re-create it.
        await fsPromises.unlink(m3u8Path).catch(() => {});
        // Write marker so we don't re-run on the next cache generation pass.
        await fsPromises.writeFile(prefetchDone, '', 'utf8').catch(() => {});
      }
      res(result);
    });
  });
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
  const thumbnailPath = join(resolve(cwd, thumbnailDir), `${file.md5}.webp`);
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
  const pathHash = createHash('md5').update(file.path).digest('hex');
  const hlsDir = join(resolve(cwd, streamCacheDir), 'hls', pathHash);

  // Fully transcoded — no work needed
  try {
    const content = await fsPromises.readFile(join(hlsDir, 'index.m3u8'), 'utf8');
    if (content.includes('#EXT-X-ENDLIST')) return false;
  } catch {
    // Not present — fall through
  }

  // Pre-cached (partial segments already generated) — on-demand will do the rest
  try {
    await fsPromises.access(join(hlsDir, 'prefetch.done'));
    return false;
  } catch {
    return true;
  }
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
