/** @format */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { logger } from '@/lib/logger';

const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';

// Browser-compatible audio codecs
const BROWSER_COMPATIBLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

// Hardware acceleration state — resolved once at module load
let _hwaccel = null;
let _hwaccelDetectionPromise = null;

/**
 * Probe a media file and return its primary video and audio codec names.
 * @param {string} filePath Absolute path to the input file
 * @param {AbortSignal} [signal] Optional signal — kills the ffprobe process immediately when aborted
 * @returns {Promise<{ videoCodec: string|null, audioCodec: string|null }>}
 */
export async function probeCodecs(filePath, signal) {
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

    // Kill the subprocess immediately when the HTTP client disconnects.
    // Without this, each probeCodecs call holds 3 pipe FDs for up to 10 s even
    // after the browser has moved on, which exhausts the OS FD limit under
    // rapid navigation and causes ECONNREFUSED for all subsequent requests.
    const onAbort = () => {
      clearTimeout(timer);
      ffprobe.kill();
      reject(new DOMException('probeCodecs aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        ffprobe.kill();
        reject(new DOMException('probeCodecs aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ffprobe.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
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
        } catch (err) {
          reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
        }
      } else {
        // code is null when killed by signal — don't log as an error
        if (!signal?.aborted) {
          reject(new Error(`ffprobe failed with code ${code}`));
        }
      }
    });

    ffprobe.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
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

export function isAudioBrowserCompatible(codec) {
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
    ? ['-c:a', 'aac', '-b:a', '128k']
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

  // Hardware path: software decode → NV12 → VAAPI upload → h264_vaapi encode.
  // Using -vaapi_device (not -hwaccel vaapi) so the decoder always runs in software,
  // which supports any input codec (HEVC, VP9, etc.) regardless of GPU decode capability.
  if (hwaccel === 'vaapi') {
    const vaapiFilter = scaleFilter
      ? `${scaleFilter},format=nv12,hwupload`
      : 'format=nv12,hwupload';

    return [
      '-vaapi_device',
      VAAPI_DEVICE,
      '-i',
      inputPath,
      '-vf',
      vaapiFilter,
      '-c:v',
      'h264_vaapi',
      '-rc_mode',
      'CQP',
      '-global_quality',
      '26',
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
    'veryfast',
  ];

  if (scaleFilter) args.push('-vf', scaleFilter);
  if (bitrate) args.push('-b:v', bitrate);

  return [...args, ...commonTail];
}

/**
 * Build FFmpeg argument array for HLS output.
 * Produces: index.m3u8 + seg000.ts, seg001.ts, ... in the same directory
 *
 * @param {string} inputPath Absolute path to source file
 * @param {string} outputM3u8 Absolute path for index.m3u8 (segments go in the same dir)
 * @param {string|null} videoCodec Detected source video codec
 * @param {string|null} audioCodec Detected source audio codec
 * @param {'vaapi'|'none'} hwaccel Hardware acceleration method
 * @returns {string[]} Complete argv for spawn('ffmpeg', args)
 */
// Codecs the UHD 630 / iHD driver can decode in hardware. Everything else
// falls through to software decode + HW encode.
const VAAPI_HW_DECODE_CODECS = new Set(['h264', 'hevc', 'h265', 'vp8', 'vp9', 'mpeg2video']);

// 8-bit 4:2:0 pixel formats that decode natively to NV12 on the iHD driver,
// which is what h264_vaapi expects as input. 10-bit (p10) and 12-bit (p12)
// sources decode to P010/P012 surfaces; converting those to NV12 requires
// scale_vaapi with format=nv12, which misbehaves on several iHD releases,
// so we fall back to software decode for them.
function isFullHwCompatible(videoCodec, pixFmt) {
  if (!VAAPI_HW_DECODE_CODECS.has(videoCodec)) return false;
  if (!pixFmt) return false;
  return pixFmt === 'yuv420p' || pixFmt === 'yuvj420p';
}

export function buildHlsArgs(
  inputPath,
  outputM3u8,
  videoCodec,
  audioCodec,
  hwaccel,
  { maxHeight, sourceHeight, pixFmt } = {}
) {
  const needsAudioTranscode = !isAudioBrowserCompatible(audioCodec);
  const audioArgs = needsAudioTranscode ? ['-c:a', 'aac', '-b:a', '128k'] : ['-c:a', 'copy'];

  // Common HLS tail — segment filename is relative because cwd=hlsDir
  const hlsTail = [
    ...audioArgs,
    // The MPEG-TS muxer defaults to muxpreload=0.5 s and muxdelay=0.7 s, which
    // offset the segment's PCR ahead of its first video frame. hls.js then sees
    // an empty buffer at currentTime=0, decides seg000 is incomplete, and
    // re-fetches it forever. Forcing both to 0 anchors the first frame at t=0.
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '0',
    '-hls_flags',
    // temp_file: ffmpeg writes seg###.ts.tmp and renames atomically on close,
    // so readers never observe a partially-written segment (mattered once we
    // moved from 200 ms polling to fs.watch, which wakes on the first write).
    'independent_segments+temp_file',
    '-hls_segment_filename',
    'seg%03d.ts',
    '-y',
    outputM3u8,
  ];

  // Only rescale when the source is actually larger than the cap. A 1080p
  // file with maxHeight=1080 would otherwise run through the scale filter for
  // a no-op resize and lose the -c:v copy fast path.
  const needsScale = !!maxHeight && (!sourceHeight || sourceHeight > maxHeight);
  const scaleFilter = needsScale
    ? `scale=w=-2:h=${maxHeight}:force_original_aspect_ratio=decrease`
    : null;

  // Pure-copy fast path: H.264 input with no rescaling needs neither decode nor encode.
  // -avoid_negative_ts make_zero shifts the earliest output timestamp to 0. Without
  // this, remuxes with non-zero starting PTS (common in MKV with edit lists or audio
  // pre-roll) produce TS segments whose first decodable frame sits at t=1.4s or similar.
  // hls.js sees an empty currentTime=0 buffer, stalls, and re-fetches seg000 forever.
  if (videoCodec === 'h264' && !needsScale) {
    return ['-i', inputPath, '-c:v', 'copy', '-avoid_negative_ts', 'make_zero', ...hlsTail];
  }

  // VAAPI encode args — shared by the full-HW and SW-decode branches.
  // -force_key_frames pins an IDR every HLS_SEG_DURATION seconds so the HLS
  // muxer can split segments cleanly at the requested 4 s boundary regardless
  // of source fps. Without this, h264_vaapi's default GOP (often 120 frames)
  // drifts the actual segment durations at 24/60 fps sources.
  const vaapiEncodeArgs = [
    '-c:v', 'h264_vaapi',
    '-rc_mode', 'CQP',
    '-global_quality', '26',
    '-idr_interval', '1',
    '-force_key_frames', 'expr:gte(t,n_forced*4)',
  ];

  if (hwaccel === 'vaapi') {
    // Full-HW pipeline: HW decode → (optional scale_vaapi) → HW encode.
    // Frames never leave the GPU, so decode and scaling are ~free CPU-wise.
    // Limited to 8-bit 4:2:0 because scale_vaapi misbehaves on p10/p12 surfaces
    // across several iHD driver versions. Anything else uses the SW-decode
    // fallback below, which is universally compatible.
    if (isFullHwCompatible(videoCodec, pixFmt)) {
      const args = [
        '-hwaccel', 'vaapi',
        '-hwaccel_output_format', 'vaapi',
        '-vaapi_device', VAAPI_DEVICE,
        '-i', inputPath,
      ];
      if (needsScale) {
        args.push('-vf', `scale_vaapi=w=-2:h=${maxHeight}`);
      }
      args.push(...vaapiEncodeArgs, ...hlsTail);
      return args;
    }

    // Fallback: SW decode → NV12 → VAAPI upload → HW encode.
    const vaapiFilter = scaleFilter
      ? `${scaleFilter},format=nv12,hwupload`
      : 'format=nv12,hwupload';
    return [
      '-vaapi_device', VAAPI_DEVICE,
      '-i', inputPath,
      '-vf', vaapiFilter,
      ...vaapiEncodeArgs,
      ...hlsTail,
    ];
  }

  // Software fallback: libx264
  const args = ['-i', inputPath, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-force_key_frames', 'expr:gte(t,n_forced*4)'];
  if (scaleFilter) args.push('-vf', scaleFilter);
  return [...args, ...hlsTail];
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
 * Get the duration of a media file in seconds using ffprobe.
 * Returns null if duration cannot be determined.
 * @param {string} filePath Absolute path to the file
 * @returns {Promise<number|null>}
 */
export function getFileDuration(filePath, signal) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (d) => { output += d.toString(); });

    const timer = setTimeout(() => {
      ffprobe.kill();
      resolve(null);
    }, 8000);

    // Kill immediately on client disconnect (same FD-leak prevention as probeCodecs)
    const onAbort = () => {
      clearTimeout(timer);
      ffprobe.kill();
      resolve(null);
    };
    if (signal) {
      if (signal.aborted) { ffprobe.kill(); resolve(null); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ffprobe.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const secs = parseFloat(output.trim());
      resolve(isNaN(secs) ? null : secs);
    });

    ffprobe.on('error', () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      resolve(null);
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
      args.push('-b:a', '128k');
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
