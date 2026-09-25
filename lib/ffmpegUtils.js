/** @format */

import { spawn } from 'child_process';
import { access, open } from 'fs/promises';
import { logger } from '@/lib/logger';
import { VAAPI_DEVICE, isAudioBrowserCompatible } from '@/lib/hlsEncode.mjs';

// Codec compatibility and the HLS encode settings live in hlsEncode.mjs, which
// the cache worker can import (this file cannot be: '@/lib/logger').
export { isAudioBrowserCompatible, isNativelyPlayable, buildHlsArgs } from '@/lib/hlsEncode.mjs';

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
            // Dolby Vision profile, or null. Decides whether HEVC can be
            // handed to the browser as-is (see chooseHlsVariant).
            dvProfile:
              videoStream?.side_data_list?.find((d) => d.side_data_type === 'DOVI configuration record')
                ?.dv_profile ?? null,
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

// Top-level ISO-BMFF box types are always four printable ASCII characters
// (ftyp, moov, mdat, free, skip, wide, pnot, uuid, moof, sidx...). Anything else
// at the top level means we are not looking at box structure — a file that isn't
// really MP4, or an offset that has drifted out of alignment.
const BOX_TYPE_RE = /^[\x20-\x7e]{4}$/;

/**
 * Check whether an MP4's `moov` atom precedes its media data — i.e. whether the
 * file is "faststart" and can begin playing before it has fully downloaded.
 *
 * WHY NOT ffprobe:
 * This used to spawn `ffprobe -show_entries format=start_time` and return
 * `code === 0`. That answers "is this file readable", not "where is moov":
 * ffprobe seeks out the atom wherever it lives, so a file with a trailing moov
 * still exits 0 and was reported faststart — the check never fired for the
 * files it existed to catch. It also carried a 1 s kill timer that resolved
 * `false`, so any file ffprobe was slow to open was reported non-faststart and
 * pushed into a full-file remux it did not need. Both failure modes, in
 * opposite directions, on the same 20 lines.
 *
 * The question is answerable from the container layout alone: an ISO-BMFF file
 * is a flat sequence of [size:u32][type:4cc] boxes, so walking the top level
 * with a handful of 16-byte positional reads shows which of `moov` / `mdat`
 * comes first. No subprocess, no timeout, and the cost is the same for a 50 MB
 * clip and a 50 GB remux.
 *
 * @param {string} filePath Absolute path to the file
 * @returns {Promise<boolean>} `true` when `moov` precedes `mdat` (streamable as-is).
 *   Also `true` when the layout can't be parsed at all: the caller answers
 *   `false` by running a full-file remux *inside an HTTP request*, which is far
 *   too expensive to trigger on a guess. An unparseable file is served as-is and
 *   left to the browser instead.
 */
export async function checkMoovAtom(filePath) {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const { size: fileSize } = await handle.stat();

    // 16 bytes covers the largest box header: u32 size + 4cc type + u64 largesize.
    const header = Buffer.alloc(16);
    let offset = 0;

    // A well-formed file reaches moov or mdat within a few boxes. The cap only
    // exists so a malformed one can't spin.
    for (let i = 0; i < 64; i++) {
      if (offset + 8 > fileSize) break;

      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) break;

      const type = header.toString('latin1', 4, 8);
      if (!BOX_TYPE_RE.test(type)) break;

      // Decided before the size is even read — an mdat that declares a bogus
      // length still tells us the media data came first.
      if (type === 'moov') return true;
      if (type === 'mdat') return false;

      let boxSize = header.readUInt32BE(0);
      if (boxSize === 1) {
        // Size 1 means the real length is the u64 immediately after the type.
        if (bytesRead < 16) break;
        const largeSize = header.readBigUInt64BE(8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
        boxSize = Number(largeSize);
        if (boxSize < 16) break; // shorter than the header that declared it
      } else if (boxSize === 0) {
        break; // "extends to end of file" — nothing can follow it
      } else if (boxSize < 8) {
        break; // malformed: a box can't be smaller than its own header
      }

      offset += boxSize;
    }

    logger.debug('ffmpegUtils: no moov/mdat found at top level, assuming faststart', { filePath });
    return true;
  } catch (err) {
    logger.debug('ffmpegUtils: moov atom check failed, assuming faststart', {
      filePath,
      error: err.message,
    });
    return true;
  } finally {
    await handle?.close();
  }
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
