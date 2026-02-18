/** @format */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { logger } from '@/lib/logger';

const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';

// Browser-compatible codec sets
const BROWSER_COMPATIBLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_COMPATIBLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

// Hardware acceleration state — resolved once at module load
let _hwaccel = null;
let _hwaccelDetectionPromise = null;

/**
 * Probe a media file and return its primary video and audio codec names.
 * @param {string} filePath Absolute path to the input file
 * @returns {Promise<{ videoCodec: string|null, audioCodec: string|null }>}
 */
export async function probeCodecs(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      filePath,
    ]);

    let stdout = '';
    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    const timer = setTimeout(() => {
      ffprobe.kill();
      reject(new Error(`ffprobe timeout for ${filePath}`));
    }, 10000); // 10 second timeout

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
        } catch (err) {
          reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}`));
      }
    });

    ffprobe.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Detect available hardware acceleration method.
 * Result is cached after first call.
 * @returns {Promise<'vaapi'|'none'>}
 */
export async function detectHardwareAccel() {
  // Return cached result immediately
  if (_hwaccel !== null) return _hwaccel;

  // Deduplicate concurrent callers during first detection
  if (_hwaccelDetectionPromise) return _hwaccelDetectionPromise;

  _hwaccelDetectionPromise = _detectHardwareAccelInternal();
  _hwaccel = await _hwaccelDetectionPromise;
  return _hwaccel;
}

async function _detectHardwareAccelInternal() {
  // Env override
  const override = process.env.HWACCEL?.toLowerCase();
  if (override === 'vaapi') {
    logger.info('ffmpegUtils: HWACCEL=vaapi override, using VAAPI');
    return 'vaapi';
  }
  if (override === 'none') {
    logger.info('ffmpegUtils: HWACCEL=none override, using software');
    return 'none';
  }

  // Auto-detect: check device node exists and is accessible
  try {
    await access(VAAPI_DEVICE);
    logger.info('ffmpegUtils: VAAPI device found, using hardware acceleration', { device: VAAPI_DEVICE });
    return 'vaapi';
  } catch {
    logger.info('ffmpegUtils: VAAPI device not accessible, falling back to software', {
      device: VAAPI_DEVICE,
    });
    return 'none';
  }
}

function isVideoBrowserCompatible(codec) {
  if (!codec) return false;
  return BROWSER_COMPATIBLE_VIDEO.has(codec);
}

function isAudioBrowserCompatible(codec) {
  if (!codec) return false;
  if (BROWSER_COMPATIBLE_AUDIO.has(codec)) return true;
  if (codec.startsWith('pcm_')) return true;
  return false;
}

/**
 * Build FFmpeg argument array for MKV-to-MP4 transcoding.
 * @param {string} inputPath Absolute path to source MKV
 * @param {string} outputPath Absolute path to destination (cache path + .tmp)
 * @param {string|null} videoCodec Detected source video codec (e.g. 'hevc', 'h264')
 * @param {string|null} audioCodec Detected source audio codec (e.g. 'dts', 'aac')
 * @param {'vaapi'|'none'} hwaccel Hardware acceleration method
 * @param {object} [options] Optional transcoding parameters
 * @param {number} [options.maxWidth] Maximum video width (will scale down if exceeded)
 * @param {number} [options.maxHeight] Maximum video height (will scale down if exceeded)
 * @param {string} [options.bitrate] Target video bitrate (e.g. '3000k', '5M')
 * @returns {string[]} Complete argv array for spawn('ffmpeg', args)
 */
export function buildMkvTranscodeArgs(
  inputPath,
  outputPath,
  videoCodec,
  audioCodec,
  hwaccel,
  { maxWidth, maxHeight, bitrate } = {}
) {
  const needsAudioTranscode = !isAudioBrowserCompatible(audioCodec);
  const audioArgs = needsAudioTranscode
    ? ['-c:a', 'aac', '-b:a', '192k']
    : ['-c:a', 'copy'];
  const commonTail = [...audioArgs, '-movflags', 'faststart', '-f', 'mp4', '-y', outputPath];

  // Build video filter for scaling if needed
  let scaleFilter = null;
  if (maxWidth || maxHeight) {
    const w = maxWidth || -1; // -1 preserves aspect ratio
    const h = maxHeight || -1;
    scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease`;
  }

  // Video is already H.264: stream copy, only fix audio if needed
  if (videoCodec === 'h264') {
    const args = ['-i', inputPath, '-c:v', 'copy'];
    if (bitrate) args.push('-b:v', bitrate);
    return [...args, ...commonTail];
  }

  // Hardware path: VAAPI upload filter + h264_vaapi encoder
  if (hwaccel === 'vaapi') {
    const vaapiFilter = scaleFilter
      ? `${scaleFilter},format=nv12|vaapi,hwupload`
      : 'format=nv12|vaapi,hwupload';

    return [
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      VAAPI_DEVICE,
      '-hwaccel_output_format',
      'vaapi',
      '-i',
      inputPath,
      '-vf',
      vaapiFilter,
      '-c:v',
      'h264_vaapi',
      ...(bitrate ? ['-b:v', bitrate] : []),
      ...commonTail,
    ];
  }

  // Software fallback
  const args = [
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',
  ];

  if (scaleFilter) args.push('-vf', scaleFilter);
  if (bitrate) args.push('-b:v', bitrate);

  return [...args, ...commonTail];
}

/**
 * Run FFmpeg with the given args and await completion.
 * @param {string} inputPath Used only for logging context
 * @param {string} outputPath Used only for logging context
 * @param {string[]} ffmpegArgs Full argv to pass to spawn('ffmpeg', ...)
 * @param {object} [options]
 * @param {number} [options.timeoutMs=7200000] Kill after this many ms (default 2 h)
 * @returns {Promise<void>}
 */
export function transcodeToMp4(inputPath, outputPath, ffmpegArgs, { timeoutMs = 7200000 } = {}) {
  const startTime = Date.now();
  logger.info('ffmpegUtils: starting transcode', { inputPath, outputPath });

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s for ${inputPath}`));
    }, timeoutMs);

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('ffmpegUtils: transcode complete', { inputPath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('ffmpegUtils: transcode failed', {
          inputPath,
          code,
          duration: `${duration}ms`,
          stderr: stderr.slice(-1000), // Last 1000 chars to avoid huge logs
        });
        reject(new Error(`FFmpeg exited with code ${code} for ${inputPath}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      logger.error('ffmpegUtils: ffmpeg spawn error', { inputPath, error: err.message });
      reject(err);
    });
  });
}

/**
 * Check if MP4 has moov atom at the beginning (required for streaming)
 */
export async function checkMoovAtom(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=start_time',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    ffprobe.on('close', (code) => {
      resolve(code === 0);
    });

    setTimeout(() => {
      ffprobe.kill();
      resolve(false);
    }, 1000);
  });
}

/**
 * Fix MP4 for streaming by moving moov atom to beginning
 */
export async function fixMp4ForStreaming(inputPath, outputPath) {
  const startTime = Date.now();
  logger.info('ffmpegUtils: fixing MP4 for streaming', { inputPath, outputPath });

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-movflags',
      'faststart',
      '-f',
      'mp4',
      '-y',
      outputPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('ffmpegUtils: MP4 fixed for streaming', { inputPath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('ffmpegUtils: FFmpeg failed to fix MP4', {
          inputPath,
          code,
          duration: `${duration}ms`,
          errorOutput,
        });
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      const duration = Date.now() - startTime;
      logger.error('ffmpegUtils: FFmpeg spawn error', {
        inputPath,
        error: err.message,
        duration: `${duration}ms`,
      });
      reject(err);
    });
  });
}

/**
 * Remux MKV to MP4 with audio transcode if needed.
 * Copies video codec as-is, transcodes audio to AAC if incompatible.
 * @param {string} inputPath Absolute path to source MKV
 * @param {string} outputPath Absolute path to destination MP4
 * @returns {Promise<void>}
 */
export async function remuxMkvToMp4(inputPath, outputPath) {
  const startTime = Date.now();
  logger.info('ffmpegUtils: remuxing MKV to MP4', { inputPath, outputPath });

  const codecs = await probeCodecs(inputPath);
  const needsAudioTranscode = !isAudioBrowserCompatible(codecs.audioCodec);

  logger.debug('ffmpegUtils: codec check', {
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    needsAudioTranscode,
  });

  return new Promise((resolve, reject) => {
    const args = [
      '-i',
      inputPath,
      '-c:v',
      'copy', // Always copy video, no re-encoding
      '-c:a',
      needsAudioTranscode ? 'aac' : 'copy', // Transcode audio if needed
    ];

    // Add audio bitrate if transcoding
    if (needsAudioTranscode) {
      args.push('-b:a', '192k');
    }

    args.push('-movflags', 'faststart', '-f', 'mp4', '-y', outputPath);

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        logger.info('ffmpegUtils: MKV remux complete', { inputPath, duration: `${duration}ms` });
        resolve();
      } else {
        logger.error('ffmpegUtils: MKV remux failed', {
          inputPath,
          code,
          duration: `${duration}ms`,
          stderr: stderr.slice(-1000),
        });
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      const duration = Date.now() - startTime;
      logger.error('ffmpegUtils: FFmpeg spawn error', {
        inputPath,
        error: err.message,
        duration: `${duration}ms`,
      });
      reject(err);
    });
  });
}
