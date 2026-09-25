/** @format */

/**
 * HLS encode settings shared by the on-demand transcoder (lib/hlsManager.js)
 * and the cache-generation worker (lib/workers/generateCacheWorker.mjs).
 *
 * WHY ONE MODULE:
 * The worker used to carry its own copy of buildHlsArgs, because ffmpegUtils
 * imports '@/lib/logger' and that alias does not resolve in a plain worker
 * process. The copy drifted: it kept 6-channel 128k AAC (the bufferAppendError
 * seg000 loop), skipped temp_file, ignored the admin's maxHeight, and encoded
 * in software unless HWACCEL=vaapi was set. Its pre-cached segments were then
 * served ahead of the on-demand job's, so one stream could switch audio layout
 * or resolution three segments in. Everything here is dependency-free so both
 * sides can import it, and the two can no longer disagree.
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';

// Seconds per segment. The pre-written VOD playlist, the forced-keyframe
// cadence and segment-index seeking all assume this value.
export const HLS_SEG_DURATION = 4;

// Browser-compatible audio codecs
const BROWSER_COMPATIBLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

export function isAudioBrowserCompatible(codec) {
  if (!codec) return false;
  if (BROWSER_COMPATIBLE_AUDIO.has(codec)) return true;
  if (codec.startsWith('pcm_')) return true;
  return false;
}

/**
 * Video codecs a <video> element will decode, per container.
 *
 * WHY PER-CONTAINER AND NOT ONE LIST:
 * The check this replaces was `videoCodec === 'h264'` gated on an extension
 * whitelist of mp4/m4v/mov/mkv. WebM is in the server's video-extension list
 * but was absent from that whitelist, so every VP8/VP9 WebM — a format every
 * target browser decodes natively — was pushed through a full H.264 HLS
 * transcode to arrive at something strictly worse than the input. Codec
 * support is a property of the (container, codec) pair, so the table is keyed
 * that way.
 *
 * MKV stays on this list, matching previous behaviour: Chromium plays it,
 * Firefox and Safari do not. That is a real bug, but a separate one from the
 * needless-transcode problem this table fixes, and narrowing it here would
 * silently push every MKV in the library through the encoder.
 */
const NATIVE_VIDEO_CODECS = {
  '.mp4': new Set(['h264']),
  '.m4v': new Set(['h264']),
  '.mov': new Set(['h264']),
  '.mkv': new Set(['h264']),
  '.webm': new Set(['vp8', 'vp9', 'av1']),
};

// WebM only permits Opus/Vorbis, so the generic MP4-oriented audio check
// (which accepts AAC, MP3, and PCM variants) does not apply to it.
const NATIVE_AUDIO_CODECS = {
  '.webm': new Set(['opus', 'vorbis']),
};

/**
 * Whether a file can be handed to a <video> element as-is, with no transcode.
 *
 * @param {string} fileExt Lowercased extension including the dot
 * @param {{videoCodec: string|null, audioCodec: string|null}|null} codecs From probeCodecs()
 * @returns {boolean}
 */
export function isNativelyPlayable(fileExt, codecs) {
  if (!codecs) return false;

  const allowedVideo = NATIVE_VIDEO_CODECS[fileExt];
  if (!allowedVideo || !allowedVideo.has(codecs.videoCodec)) return false;

  // No audio stream at all — nothing left that could be incompatible. Silent
  // recordings used to fail the audio check and get transcoded for no reason.
  if (!codecs.audioCodec) return true;

  const allowedAudio = NATIVE_AUDIO_CODECS[fileExt];
  return allowedAudio ? allowedAudio.has(codecs.audioCodec) : isAudioBrowserCompatible(codecs.audioCodec);
}

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

// Only rescale when the source is actually larger than the cap. A 1080p
// file with maxHeight=1080 would otherwise run through the scale filter for
// a no-op resize and lose the -c:v copy fast path.
function needsScale(maxHeight, sourceHeight) {
  return !!maxHeight && (!sourceHeight || sourceHeight > maxHeight);
}

/**
 * Whether buildHlsArgs will stream-copy the video rather than re-encode it.
 *
 * Stream-copied segments split at the source's own keyframes, so their count
 * and boundaries are unknown up front: no pre-written VOD playlist, and no
 * starting at an arbitrary segment index. Re-encoded segments are cut at a
 * forced keyframe every HLS_SEG_DURATION seconds, so segment N always starts
 * at N * HLS_SEG_DURATION.
 */
export function willStreamCopy(videoCodec, { maxHeight, sourceHeight, variant } = {}) {
  if (variant === 'hevc') return true;
  return videoCodec === 'h264' && !needsScale(maxHeight, sourceHeight);
}

/** The player's `hevc` query parameter → 0 | 1 | 2 (see chooseHlsVariant). */
export function parseHevcSupport(value) {
  return value === '2' ? 2 : value === '1' ? 1 : 0;
}

/**
 * Which rendition to build for this viewer: 'h264' (the default, playable
 * everywhere) or 'hevc' — the source's own HEVC stream copied into fMP4
 * segments, no encode at all.
 *
 * WHY:
 * Most large MKVs are HEVC, and every one of them went through a full-length
 * H.264 encode on the iGPU, one film at a time. Browsers on hardware with an
 * HEVC decoder (Safari; Chrome and Edge since 107) can play the stream as it
 * is, which turns a transcode that runs about as long as the film into a remux
 * that takes seconds.
 *
 * @param {object|null} probe From probeCache
 * @param {object} options
 * @param {0|1|2} options.hevcSupport What the viewer's browser reported it can
 *   decode: 0 none, 1 HEVC Main (8-bit), 2 Main 10 as well.
 * @param {number|null} options.maxHeight Admin resolution cap
 * @returns {'h264'|'hevc'}
 */
export function chooseHlsVariant(probe, { hevcSupport = 0, maxHeight } = {}) {
  if (!hevcSupport || probe?.videoCodec !== 'hevc') return 'h264';
  // A copy cannot be scaled; honour the cap with the H.264 encode instead.
  if (maxHeight && !(probe.videoHeight && probe.videoHeight <= maxHeight)) return 'h264';
  // Dolby Vision profile 5 has no HDR10 or SDR base layer. A decoder that
  // does not apply the Dolby Vision reshaping — every browser — shows it in
  // green and purple.
  if (probe.dvProfile === 5) return 'h264';
  const required = { yuv420p: 1, yuvj420p: 1, yuv420p10le: 2 }[probe.pixFmt];
  return required && hevcSupport >= required ? 'hevc' : 'h264';
}

/**
 * The encoder the on-demand path uses. HWACCEL=none is the only way to force
 * software; a VAAPI failure falls back to libx264 at run time.
 */
export function defaultHwaccel() {
  return process.env.HWACCEL?.toLowerCase() === 'none' ? 'none' : 'vaapi';
}

/**
 * Build FFmpeg argument array for HLS output.
 * Produces: <outputM3u8> + seg000.ts, seg001.ts, ... in ffmpeg's cwd.
 *
 * @param {string} inputPath Absolute path to source file
 * @param {string} outputM3u8 Playlist path (segments go in the cwd)
 * @param {string|null} videoCodec Detected source video codec
 * @param {string|null} audioCodec Detected source audio codec
 * @param {'vaapi'|'none'} hwaccel Hardware acceleration method
 * @param {object} [options]
 * @param {number|null} [options.maxHeight] Admin resolution cap
 * @param {number|null} [options.sourceHeight] Probed source height
 * @param {string|null} [options.pixFmt] Probed source pixel format
 * @param {number} [options.startSegment=0] First segment index to write.
 *   Re-encode only — see willStreamCopy. Segments before it are assumed to
 *   exist already; ffmpeg seeks to their end and numbers its output from here,
 *   with timestamps continuing where they left off.
 * @param {number} [options.maxSecs] Stop after this many seconds of output
 *   (partial pre-cache).
 * @param {'h264'|'hevc'} [options.variant='h264'] See chooseHlsVariant.
 * @returns {string[]} Complete argv for spawn('ffmpeg', args)
 */
export function buildHlsArgs(
  inputPath,
  outputM3u8,
  videoCodec,
  audioCodec,
  hwaccel,
  { maxHeight, sourceHeight, pixFmt, startSegment = 0, maxSecs, variant = 'h264' } = {}
) {
  const needsAudioTranscode = !isAudioBrowserCompatible(audioCodec);
  // Downmix to stereo, and do not leave the bitrate at 128k.
  //
  // WEB-DL releases carry 5.1 E-AC-3, and encoding that straight through to
  // 6-channel AAC is what breaks HLS playback in the browser. hls.js transmuxes
  // TS→fMP4 client-side and derives the audio SourceBuffer's codec string and
  // channel config from the ADTS header; Chrome then rejects the append with a
  // bufferAppendError on sourceBufferName "audio". hls.js treats that as
  // non-fatal and retries by refetching the segment, which is the seg000
  // request storm — the server is answering 200 every time, the browser just
  // cannot decode what it gets.
  //
  // -ac 2 also fixes the bitrate: 128k spread across 6 channels is ~21 kbps per
  // channel, far below what the native encoder needs. 192k stereo is ~96 kbps
  // per channel. -ar 48000 pins the sample rate so the ADTS sampling-frequency
  // index stays constant across segments.
  const audioArgs = needsAudioTranscode
    ? ['-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k']
    : ['-c:a', 'copy'];

  const streamCopy = willStreamCopy(videoCodec, { maxHeight, sourceHeight, variant });
  // HEVC is only defined for HLS in fragmented MP4, not MPEG-TS.
  const fmp4 = variant === 'hevc';
  const startSecs = streamCopy ? 0 : startSegment * HLS_SEG_DURATION;

  // Input-side -ss on a re-encode is frame-accurate: ffmpeg decodes from the
  // preceding keyframe and drops frames before startSecs, so the first frame
  // out is the first one the previous segment did not contain.
  const input = startSecs > 0 ? ['-ss', String(startSecs), '-i', inputPath] : ['-i', inputPath];

  // Common HLS tail — segment filename is relative because cwd=hlsDir
  const hlsTail = [
    ...audioArgs,
    ...(maxSecs ? ['-t', String(maxSecs)] : []),
    // Seeking restarts output timestamps at 0. Shift them back to where they
    // sit in the source: hls.js places a segment on the timeline by its PTS,
    // and a segment claiming t=0 in the middle of the playlist would be
    // buffered over the start of the film. Applied by the muxer, after the
    // encoder, so -force_key_frames below still counts from 0 and lands on
    // absolute multiples of HLS_SEG_DURATION.
    ...(startSecs > 0 ? ['-output_ts_offset', String(startSecs)] : []),
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
    String(HLS_SEG_DURATION),
    '-hls_list_size',
    '0',
    ...(startSecs > 0 ? ['-start_number', String(startSegment)] : []),
    // A Media Playlist carrying neither #EXT-X-PLAYLIST-TYPE nor #EXT-X-ENDLIST
    // is a LIVE playlist by spec, and that is exactly what FFmpeg's in-progress
    // index.m3u8 looks like. hls.js then applies live-edge sync to it: it picks
    // a start position near the end of the list and re-evaluates it on every
    // playlist reload. Because stream-copy runs many times faster than realtime
    // the live edge races ahead between reloads, so the player is permanently
    // "behind the window" and keeps re-resolving position 0 back to seg000 —
    // refetching it in a tight loop instead of ever advancing.
    //
    // EVENT declares what is actually true here (append-only, hls_list_size=0,
    // nothing ever removed), which makes hls.js play it from the start like VOD
    // and keep reloading until the ENDLIST that av_write_trailer appends.
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    // temp_file: ffmpeg writes seg###.ts.tmp and renames atomically on close,
    // so readers never observe a partially-written segment (mattered once we
    // moved from 200 ms polling to fs.watch, which wakes on the first write).
    'independent_segments+temp_file',
    ...(fmp4 ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'] : []),
    '-hls_segment_filename',
    fmp4 ? 'seg%03d.m4s' : 'seg%03d.ts',
    '-y',
    outputM3u8,
  ];

  const scaleFilter = needsScale(maxHeight, sourceHeight)
    ? `scale=w=-2:h=${maxHeight}:force_original_aspect_ratio=decrease`
    : null;

  // Pure-copy fast path: H.264 input with no rescaling needs neither decode nor encode.
  // -avoid_negative_ts make_zero shifts the earliest output timestamp to 0. Without
  // this, remuxes with non-zero starting PTS (common in MKV with edit lists or audio
  // pre-roll) produce TS segments whose first decodable frame sits at t=1.4s or similar.
  // hls.js sees an empty currentTime=0 buffer, stalls, and re-fetches seg000 forever.
  if (streamCopy) {
    // hvc1, not ffmpeg's default hev1: Safari will not play HEVC tagged hev1,
    // and hvc1 plays everywhere HEVC does.
    const tag = fmp4 ? ['-tag:v', 'hvc1'] : [];
    return [...input, '-c:v', 'copy', ...tag, '-avoid_negative_ts', 'make_zero', ...hlsTail];
  }

  // -force_key_frames pins an IDR every HLS_SEG_DURATION seconds so the HLS
  // muxer can split segments cleanly at the requested boundary regardless of
  // source fps. Without this, h264_vaapi's default GOP (often 120 frames)
  // drifts the actual segment durations at 24/60 fps sources.
  const forceKeyFrames = ['-force_key_frames', `expr:gte(t,n_forced*${HLS_SEG_DURATION})`];

  // VAAPI encode args — shared by the full-HW and SW-decode branches.
  const vaapiEncodeArgs = [
    '-c:v', 'h264_vaapi',
    '-rc_mode', 'CQP',
    '-global_quality', '26',
    '-idr_interval', '1',
    ...forceKeyFrames,
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
        ...input,
      ];
      if (scaleFilter) {
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
      ...input,
      '-vf', vaapiFilter,
      ...vaapiEncodeArgs,
      ...hlsTail,
    ];
  }

  // Software fallback: libx264
  const args = [...input, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', ...forceKeyFrames];
  if (scaleFilter) args.push('-vf', scaleFilter);
  return [...args, ...hlsTail];
}

export function hlsSegmentName(index) {
  return `seg${String(index).padStart(3, '0')}.ts`;
}

// ─── Partial pre-cache ───────────────────────────────────────────────────────
//
// The cache worker encodes the first few segments of a video ahead of time and
// records them in PREFETCH_MARKER. The on-demand job then starts ffmpeg after
// them instead of re-encoding them from 0.
//
// The marker records what the segments were encoded with. Segments made under
// a different maxHeight, or by an older buildHlsArgs, would sit in the same
// stream as the on-demand job's with a different resolution or audio layout,
// so a marker that does not match is treated as absent.

export const PREFETCH_MARKER = 'prefetch.done';
// The worker's own playlist. Never index.m3u8: that name belongs to the
// on-demand job, and a finished partial run stamps it with #EXT-X-ENDLIST.
export const PREFETCH_PLAYLIST = 'prefetch.m3u8';

// Bump whenever buildHlsArgs changes what ends up in a segment (codec, audio
// layout, timestamps), so segments pre-cached under the old settings are
// re-made rather than spliced into new ones.
export const HLS_ARGS_VERSION = 2;

export function prefetchMarkerContent({ segments, maxHeight }) {
  return JSON.stringify({ v: HLS_ARGS_VERSION, segments, maxHeight: maxHeight ?? null });
}

/**
 * Number of leading segments in hlsDir that were pre-cached under the current
 * settings and can be kept, or 0.
 */
export async function readPrefetchedSegments(hlsDir, maxHeight) {
  try {
    const marker = JSON.parse(await readFile(join(hlsDir, PREFETCH_MARKER), 'utf8'));
    if (marker.v !== HLS_ARGS_VERSION || (marker.maxHeight ?? null) !== (maxHeight ?? null)) return 0;
    const segments = Number.isInteger(marker.segments) && marker.segments > 0 ? marker.segments : 0;
    for (let i = 0; i < segments; i++) await access(join(hlsDir, hlsSegmentName(i)));
    return segments;
  } catch {
    return 0;
  }
}
