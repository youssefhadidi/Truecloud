/** @format */

/**
 * HLS Transcode Manager
 *
 * Singleton job registry for on-demand HLS transcoding.
 * Node.js module caching ensures a single Map is shared across all imports.
 *
 * Output directory: stream-cache/hls/{hlsRenditionHash(...)}/ — one per file
 * version, variant, maxHeight and HLS_ARGS_VERSION.
 *   playlist.m3u8 - full VOD playlist, pre-written (re-encode path only)
 *   index.m3u8    - completion marker: present with #EXT-X-ENDLIST only once
 *                   every segment exists. On the stream-copy path it is also
 *                   ffmpeg's growing playlist, which is what gets served.
 *   seg000.ts     - first 4-second segment
 *   seg001.ts     - second 4-second segment, etc. On the re-encode path these
 *                   may be written out of order (see requestHlsSegment).
 *
 * The HEVC-copy rendition (see chooseHlsVariant) lives in a directory of its
 * own, as init.mp4 + seg000.m4s, seg001.m4s, ... with ffmpeg's index.m3u8.
 */

import { spawn } from 'child_process';
import { readdir, readFile, mkdir, writeFile, rm, stat, access } from 'fs/promises';
import { join, basename } from 'node:path';
import { logger } from '@/lib/logger';
import {
  buildHlsArgs,
  willStreamCopy as isStreamCopy,
  readPrefetchedSegments,
  hlsRenditionHash,
  hlsSegmentName,
  HLS_SEG_DURATION,
  HLS_ARGS_VERSION,
  WORKER_LOCK,
} from '@/lib/hlsEncode.mjs';
import { createJob, startJob, setJobChild, setJobProgress, addJobLog, completeJob, getJob } from '@/lib/jobManager';
import { Semaphore } from '@/lib/semaphore.mjs';

// ─── Encode concurrency cap ───────────────────────────────────────────────────
// Only one HLS ffmpeg job runs at a time. The iGPU has a single VAAPI encode
// engine, so parallel jobs serialize on the hardware anyway — queuing them
// explicitly avoids contention (and, in the software-fallback case, prevents
// two libx264 jobs from fighting for all CPU cores at once).
const hlsEncodeSemaphore = new Semaphore(1);

// ─── Job registry ─────────────────────────────────────────────────────────────
// fileHash → { status: 'transcoding'|'done'|'error', progress: 0-100, error?: string }
const jobs = new Map();

// ─── Encode queue ─────────────────────────────────────────────────────────────
// Hashes waiting on hlsEncodeSemaphore, in the order they will be admitted.
// Exists purely so the player can say "3rd in queue" instead of showing a
// stalled 0% progress bar for however long the job ahead of it takes — with a
// single encode slot, that wait can be the length of a film.
const encodeQueue = [];

/** 1-based position in the encode queue; 0 when running or not queued. */
export function getHlsQueuePosition(hash) {
  const idx = encodeQueue.indexOf(hash);
  return idx === -1 ? 0 : idx + 1;
}

// NOTE: the native-streamable registry that used to live here is now
// lib/probeCache.js — it stored a boolean derived from codecs we were already
// probing for, so it has been folded into the probe cache alongside them.
// Nativeness is now `isNativelyPlayable(ext, await getProbeInfo(path))`.

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The rendition directory for this version of the file under these settings
 * (see hlsRenditionHash). A file replaced in place, or a change of variant,
 * maxHeight or encode args, gets a fresh directory; the old one is left to the
 * pruner. Each also gets its own entry in `jobs`.
 *
 * Rejects if the source file is missing.
 * @param {{ variant?: 'h264'|'hevc', maxHeight?: number|null }} [rendition]
 */
export async function getHlsOutputDir(fullPath, cacheDir, rendition = {}) {
  const hash = hlsRenditionHash(fullPath, await stat(fullPath), rendition);
  return { hash, hlsDir: join(cacheDir, 'hls', hash) };
}

/**
 * Check whether the HLS transcode is fully complete.
 * "Complete" means the manifest exists AND contains #EXT-X-ENDLIST.
 * Returns the path to index.m3u8 if complete, null otherwise.
 */
export async function isHlsCacheComplete(fullPath, cacheDir, rendition = {}) {
  try {
    const { hlsDir } = await getHlsOutputDir(fullPath, cacheDir, rendition);
    const m3u8Path = join(hlsDir, 'index.m3u8');
    const content = await readFile(m3u8Path, 'utf8');
    return content.includes('#EXT-X-ENDLIST') ? m3u8Path : null;
  } catch {
    return null;
  }
}

// ─── Job status ───────────────────────────────────────────────────────────────

export function getHlsJobStatus(hash) {
  const job = jobs.get(hash);
  if (!job) return { status: 'none', progress: 0, queuePosition: 0 };
  // Not a spread: the job also holds the live ffmpeg process and run state.
  const { status, progress, error } = job;
  return { status, progress, error, queuePosition: getHlsQueuePosition(hash) };
}

/**
 * Record that someone is still watching this job's video. Called on every
 * status poll and HLS request; the open player polls at least every 3 s while
 * a transcode runs, so a job that goes quiet for IDLE_PREEMPT_MS has been
 * closed. See the idle watchdog below.
 */
export function touchHlsJob(hash) {
  const job = jobs.get(hash);
  if (job) job.lastAccess = Date.now();
}

/**
 * Whether the player can attach to a transcode that is still running.
 *
 * Playback used to wait for two segments on disk, discovered by a 3 s poll —
 * several seconds of spinner before a frame the HLS route could already serve,
 * since it holds each segment request until ffmpeg writes it. What the player
 * actually needs is a manifest describing the segments this job will write:
 * the pre-written VOD playlist on the re-encode path, or ffmpeg's own
 * index.m3u8 (which appears with the first segment) on the stream-copy path.
 *
 * A queued job is never ready: its segment requests would sit out the route's
 * 30 s wait behind someone else's encode and fail.
 */
export async function isHlsEarlyPlaybackReady(hash, hlsDir) {
  const job = jobs.get(hash);
  if (job?.status !== 'transcoding' || getHlsQueuePosition(hash) > 0) return false;
  if (job.vodManifest) return true;
  try {
    await access(join(hlsDir, 'index.m3u8'));
    return true;
  } catch {
    return false;
  }
}

// ─── VOD manifest pre-write ───────────────────────────────────────────────────

/**
 * Write a complete VOD playlist before FFmpeg starts so hls.js sees the full
 * duration immediately instead of watching the seek bar grow segment by segment.
 * The file is named playlist.m3u8 (not index.m3u8) so FFmpeg's own manifest
 * doesn't overwrite it.
 */
async function prewriteVodManifest(hlsDir, durationSecs, maxSegments = Infinity) {
  if (!durationSecs || durationSecs <= 0) return;

  const numSegments = Math.min(Math.ceil(durationSecs / HLS_SEG_DURATION), maxSegments);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${HLS_SEG_DURATION + 1}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (let i = 0; i < numSegments; i++) {
    const remaining = durationSecs - i * HLS_SEG_DURATION;
    const segDur = Math.min(HLS_SEG_DURATION, remaining);
    lines.push(`#EXTINF:${segDur.toFixed(6)},`);
    lines.push(hlsSegmentName(i));
  }

  lines.push('#EXT-X-ENDLIST');
  await writeFile(join(hlsDir, 'playlist.m3u8'), lines.join('\n') + '\n', 'utf8');
}


// ─── Segment files ────────────────────────────────────────────────────────────

const SEGMENT_FILE_RE = /^seg(\d+)\.(?:ts|m4s)(\.tmp)?$/;

// ffmpeg's playlist on the seekable path. Nothing reads it: the player gets
// the pre-written playlist.m3u8, and index.m3u8 is written by us once every
// segment exists. Each ffmpeg run stamps its own playlist #EXT-X-ENDLIST when
// it stops, so letting a run write index.m3u8 would mark a partial transcode
// complete — which is also what a cancelled (SIGTERM'd) job used to do.
const RUN_PLAYLIST = 'run.m3u8';

/**
 * Delete segN.ts for every N >= fromIndex, and every segN.ts.tmp (only ever
 * left behind by an ffmpeg that was killed mid-segment).
 */
async function clearSegmentsFrom(hlsDir, fromIndex) {
  const entries = await readdir(hlsDir);
  await Promise.all(
    entries
      .filter((name) => {
        const m = SEGMENT_FILE_RE.exec(name);
        return m && (m[2] || parseInt(m[1], 10) >= fromIndex);
      })
      .map((name) => rm(join(hlsDir, name), { force: true })),
  );
}

/** Indices of the finished segments in hlsDir. */
async function listSegments(hlsDir) {
  const present = new Set();
  for (const name of await readdir(hlsDir)) {
    const m = SEGMENT_FILE_RE.exec(name);
    if (m && !m[2]) present.add(parseInt(m[1], 10));
  }
  return present;
}

/** First index in [after, total) then [0, after) that still needs encoding. */
function nextMissing(present, unreachable, after, total) {
  for (let pass = 0; pass < 2; pass++) {
    const [lo, hi] = pass === 0 ? [after, total] : [0, Math.min(after, total)];
    for (let i = lo; i < hi; i++) {
      if (!present.has(i) && !unreachable.has(i)) return i;
    }
  }
  return null;
}

// ─── Progress parsing ─────────────────────────────────────────────────────────

function parseTimeSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
}

function isCancelled(jobId) {
  return getJob(jobId)?.status === 'cancelled';
}

// ─── Seeking past the encoder ─────────────────────────────────────────────────

// A request for a segment the encoder would take longer than this (wall-clock)
// to reach restarts ffmpeg at that segment instead. A restart costs about a
// second — spawn, seek, decode up to the keyframe — so anything further than a
// few seconds out is faster to jump to than to wait for; and the HLS route
// gives up on a segment after 30 s, so a seek into the second half of a film
// used to fail outright.
const SEEK_WAIT_SECS = 5;
// Before the first speed report of a job, how many segments ahead still counts
// as "about to be written".
const SEEK_WAIT_UNKNOWN_SPEED_SEGMENTS = 3;

/**
 * Called by the HLS route when a player asks for a segment that is not on disk.
 * If the running encode will not reach it soon, restart ffmpeg at that segment.
 *
 * Only seekable jobs (re-encode with a pre-written playlist) can do this: there
 * segment N always starts at N * HLS_SEG_DURATION, so a run started there
 * produces exactly the segment the playlist promised. Stream-copy segments cut
 * at the source's keyframes and cannot be started mid-file.
 */
export function requestHlsSegment(hash, index) {
  const job = jobs.get(hash);
  if (!job?.seekable || job.status !== 'transcoding') return;
  if (job.unreachable?.has(index) || job.seekTo === index) return;

  if (job.proc && job.run && job.seekTo == null) {
    const { from, stopAt } = job.run;
    if (index >= from && index < stopAt) {
      const ahead = index - Math.floor(job.cursorSecs / HLS_SEG_DURATION);
      if (ahead <= 0) return; // the segment being encoded right now
      // No speed yet means this run has only just started — often the one a
      // seek began, with the player now asking for the segments right after
      // it. Those are moments away; restarting for them would throw that away.
      if (!(job.speed > 0)) {
        if (ahead <= SEEK_WAIT_UNKNOWN_SPEED_SEGMENTS) return;
      } else if ((ahead * HLS_SEG_DURATION) / job.speed <= SEEK_WAIT_SECS) {
        return;
      }
    }
  }

  logger.info('hlsManager: segment requested past the encoder, restarting there', {
    hash,
    segment: index,
    runFrom: job.run?.from,
    cursorSecs: job.cursorSecs,
    speed: job.speed,
  });
  // The run loop picks this up once the current ffmpeg exits (or at its next
  // iteration if none is running). SIGKILL, not SIGTERM: a graceful exit would
  // close the half-written segment and rename it into place, truncated.
  job.seekTo = index;
  job.proc?.kill('SIGKILL');
}

// ─── Idle preemption ──────────────────────────────────────────────────────────

// With one encode slot, a transcode keeps running after its viewer has closed
// the video, and anyone who opens another video waits behind all of it — a
// whole film, for a video nobody is watching. While someone is queued, a
// running job with no status poll or HLS request for this long is stopped.
const IDLE_PREEMPT_MS = 30_000;
const IDLE_CHECK_MS = 5_000;

// Left by a stopped job so the next start keeps its segments; records what
// they were encoded with, like the prefetch marker.
const RESUME_MARKER = 'resume.json';

function resumeMarkerContent(maxHeight) {
  return JSON.stringify({ v: HLS_ARGS_VERSION, maxHeight: maxHeight ?? null });
}

/** Whether a matching resume marker was present. Removes it either way. */
async function consumeResumeMarker(hlsDir, maxHeight) {
  const markerPath = join(hlsDir, RESUME_MARKER);
  try {
    return (await readFile(markerPath, 'utf8')) === resumeMarkerContent(maxHeight);
  } catch {
    return false;
  } finally {
    await rm(markerPath, { force: true }).catch(() => {});
  }
}

let idleWatchdog = null;

// Runs only while there is a queue, which is the only time idleness matters:
// with nobody waiting, finishing the encode costs nothing and fills the cache.
function ensureIdleWatchdog() {
  if (idleWatchdog) return;
  idleWatchdog = setInterval(() => {
    if (encodeQueue.length === 0) {
      clearInterval(idleWatchdog);
      idleWatchdog = null;
      return;
    }
    const now = Date.now();
    for (const [hash, job] of jobs) {
      // Stream-copy jobs are left alone: they cannot resume, so the work would
      // be lost, and a remux is over in a minute or two anyway.
      if (job.status !== 'transcoding' || !job.proc || !job.seekable || job.preempted) continue;
      if (now - (job.lastAccess ?? 0) < IDLE_PREEMPT_MS) continue;
      logger.info('hlsManager: stopping idle HLS job for the queue', {
        hash,
        idleSecs: Math.round((now - job.lastAccess) / 1000),
        queued: encodeQueue.length,
      });
      job.preempted = true;
      job.proc.kill('SIGKILL');
    }
  }, IDLE_CHECK_MS);
  idleWatchdog.unref?.();
}

// ─── Cache worker ─────────────────────────────────────────────────────────────

/**
 * Stop a cache-worker ffmpeg writing into hlsDir, if there is one (see
 * WORKER_LOCK). Someone is waiting to watch this video, so their job takes the
 * directory; left running, the worker's ffmpeg would write segments alongside
 * this job's and could stamp index.m3u8 complete over a partial rendition.
 *
 * The lock is removed before the kill, so by the time the worker sees its
 * ffmpeg exit it can already tell it was preempted rather than failed (and
 * must not retry in software).
 *
 * @returns {Promise<boolean>} Whether a worker encode had been writing here.
 */
async function preemptWorkerEncode(hlsDir) {
  const lockPath = join(hlsDir, WORKER_LOCK);
  let pid;
  try {
    pid = JSON.parse(await readFile(lockPath, 'utf8')).pid;
  } catch {
    return false; // no worker encode here
  }
  await rm(lockPath, { force: true }).catch(() => {});
  if (!Number.isInteger(pid)) return true;

  // A lock left by a worker that died can name a pid since reused by
  // something else: only kill an ffmpeg that is writing into this directory.
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    if (!cmdline.includes('ffmpeg') || !cmdline.includes(hlsDir)) return true;
    process.kill(pid, 'SIGKILL');
  } catch {
    return true; // already gone, or no /proc
  }

  // Wait for it to be gone, so it can't rename a segment into place after the
  // stale-segment sweep below.
  for (let i = 0; i < 40; i++) {
    try {
      await access(`/proc/${pid}`);
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  logger.info('hlsManager: stopped a cache-worker encode for on-demand playback', { hlsDir, pid });
  return true;
}

// ─── Start HLS job ────────────────────────────────────────────────────────────

/**
 * Start a background HLS transcode job.
 * Idempotent: if the job is already running or complete, returns immediately.
 *
 * @param {string} fullPath       Absolute path to source file
 * @param {string} cacheDir       Base cache directory (stream-cache)
 * @param {object} codecs         { videoCodec, audioCodec } from probeCodecs()
 * @param {'vaapi'|'none'} hwaccel
 * @param {number|null} durationSecs  Total duration for progress tracking
 * @param {object} [options]
 * @param {number|null} [options.maxHeight] Admin resolution cap
 * @param {'h264'|'hevc'} [options.variant='h264'] From chooseHlsVariant
 * @returns {Promise<{ status: 'transcoding'|'done'|'error', progress: number }>}
 */
export async function startHlsJob(fullPath, cacheDir, codecs, hwaccel, durationSecs, { maxHeight, variant = 'h264' } = {}) {
  const { videoHeight = null, pixFmt = null } = codecs ?? {};
  const rendition = { variant, maxHeight };
  const { hash, hlsDir } = await getHlsOutputDir(fullPath, cacheDir, rendition);

  // Already complete on disk
  const complete = await isHlsCacheComplete(fullPath, cacheDir, rendition);
  if (complete) {
    jobs.delete(hash);
    return { status: 'done', progress: 100 };
  }

  // Already running
  const existing = jobs.get(hash);
  if (existing && existing.status === 'transcoding') {
    return { status: 'transcoding', progress: existing.progress, queuePosition: getHlsQueuePosition(hash) };
  }

  // Already failed — don't retry
  if (existing && existing.status === 'error') {
    return { status: 'error', progress: 0, error: existing.error };
  }

  // Mark as started
  const job = { status: 'transcoding', progress: 0, lastAccess: Date.now() };
  jobs.set(hash, job);

  const jobId = createJob(basename(fullPath), 'hls-transcode');
  job._jobId = jobId;
  startJob(jobId);

  await mkdir(hlsDir, { recursive: true });

  await preemptWorkerEncode(hlsDir);

  // Any index.m3u8 here is from an earlier run that never finished (a finished
  // one returned above). ffmpeg only rewrites it once its first segment closes,
  // so until then it would pass isHlsEarlyPlaybackReady and hand the player a
  // manifest for a run that is not the one now starting.
  await rm(join(hlsDir, 'index.m3u8'), { force: true }).catch((err) => {
    logger.warn('hlsManager: failed to clear stale ffmpeg manifest', { fullPath, error: err.message });
  });

  // Pre-write a complete VOD manifest so hls.js sees the full duration immediately.
  // playlist.m3u8 is served by the HLS route; FFmpeg writes its own index.m3u8.
  //
  // Only valid when FFmpeg will re-encode with -force_key_frames every 4 s — the
  // pre-written manifest hardcodes that segment cadence. Stream-copy (H.264 source
  // that fits under maxHeight) splits at the source's native keyframes instead,
  // producing fewer, variable-duration segments that don't match the pre-written
  // playlist. In that case we skip the pre-write and let the HLS route fall back
  // to FFmpeg's growing index.m3u8, which is accurate.
  const willStreamCopy = isStreamCopy(codecs.videoCodec, { maxHeight, sourceHeight: videoHeight, variant });
  if (durationSecs && !willStreamCopy) {
    const written = await prewriteVodManifest(hlsDir, durationSecs).then(
      () => true,
      (err) => {
        logger.warn('hlsManager: failed to pre-write VOD manifest', { fullPath, error: err.message });
        return false;
      },
    );
    // Set only after the write lands, so a status poll between jobs.set above
    // and here can't hand out a playlist that isn't on disk yet (or is a stale
    // one about to be replaced).
    if (written) job.vodManifest = true;
  } else {
    // Skipping the pre-write is not enough: the HLS route prefers playlist.m3u8
    // over index.m3u8 unconditionally, and nothing ever deletes it. A playlist
    // left behind by an earlier run of this same file under different settings
    // (e.g. maxHeight was 720 so it re-encoded at a fixed 4 s cadence, then the
    // admin raised the cap so it now stream-copies) would be served against
    // segments it does not describe — uniform 4.000000 s EXTINF entries and a
    // segment count derived from duration, against keyframe-aligned segments
    // that are longer and fewer. Remove it so the route falls through to
    // FFmpeg's index.m3u8, which always matches what was actually written.
    await rm(join(hlsDir, 'playlist.m3u8'), { force: true }).catch((err) => {
      logger.warn('hlsManager: failed to clear stale VOD manifest', { fullPath, error: err.message });
    });
  }

  // Seekable: segment N starts at N * HLS_SEG_DURATION, so ffmpeg can be
  // started at any segment — to skip pre-cached ones, to jump to where the
  // viewer seeked, or to fill the gaps a jump leaves behind.
  job.seekable = !!job.vodManifest;

  // A job stopped by the idle watchdog left its segments for us: keep them all
  // and encode only what is missing. Otherwise, pick up after the cache
  // worker's pre-encoded segments rather than redoing them. Either way the
  // pre-written playlist is what lists the kept segments to the player.
  let startSegment = 0;
  const resuming = job.seekable && (await consumeResumeMarker(hlsDir, maxHeight));
  if (resuming) {
    startSegment = null; // runJob starts at the first gap
  } else if (job.seekable) {
    const prefetched = await readPrefetchedSegments(hlsDir, maxHeight);
    if (prefetched * HLS_SEG_DURATION < durationSecs) startSegment = prefetched;
  }

  // Every other segment here is from a run that never finished — possibly
  // under other settings (older audio args, a different maxHeight), or closed
  // half-written by a SIGTERM. The HLS route serves any segment that exists,
  // so a leftover would reach the player before ffmpeg overwrote it and splice
  // a mismatched stream into this one.
  await clearSegmentsFrom(hlsDir, resuming ? Infinity : startSegment).catch((err) => {
    logger.warn('hlsManager: failed to clear stale segments', { fullPath, error: err.message });
  });

  const ctx = { job, hash, hlsDir, fullPath, codecs, videoHeight, pixFmt, maxHeight, variant, durationSecs, jobId };

  // Fire-and-forget: acquire the encode slot, then run ffmpeg until every
  // segment exists. Must not be awaited — the HTTP handler calls startHlsJob
  // and expects it to return quickly so the client can start polling. If the
  // slot is busy, the job sits in the queue with status='transcoding',
  // progress=0 until the current job finishes.
  (async () => {
    // Register in the queue *before* awaiting, so a status poll landing in the
    // gap reports the right position instead of a job that looks like it is
    // running but never advances past 0%.
    if (hlsEncodeSemaphore.count >= hlsEncodeSemaphore.max) {
      encodeQueue.push(hash);
      ensureIdleWatchdog();
      logger.info('hlsManager: queued behind active HLS job', {
        fullPath,
        queuePosition: encodeQueue.length,
      });
    }
    try {
      await hlsEncodeSemaphore.acquire();
    } finally {
      const queueIdx = encodeQueue.indexOf(hash);
      if (queueIdx !== -1) encodeQueue.splice(queueIdx, 1);
    }
    // Time spent queued is not idleness — the viewer was polling the queue.
    job.lastAccess = Date.now();

    try {
      // The cache worker only avoids directories written to in the last
      // minute, so a long wait in the queue can let it start an encode in
      // here. Its partial index.m3u8 would pass for this job's (the early-
      // playback manifest on the stream-copy path, the completion marker on
      // the seekable one); a stream-copy job also starts over from segment 0.
      if (await preemptWorkerEncode(hlsDir)) {
        await rm(join(hlsDir, 'index.m3u8'), { force: true }).catch(() => {});
        if (!job.seekable) await clearSegmentsFrom(hlsDir, 0).catch(() => {});
      }
      await runJob(ctx, hwaccel, startSegment);
    } catch (err) {
      const message = err.message || String(err);
      job.status = 'error';
      job.error = message;
      job.progress = 0;
      logger.error('hlsManager: HLS transcode failed', { fullPath, error: message.slice(-800) });
      completeJob(jobId, false, message.slice(-200));
      // A failed ffmpeg can still write its trailer, and on the stream-copy
      // path that stamps index.m3u8 #EXT-X-ENDLIST over a partial transcode.
      if (!job.seekable) await rm(join(hlsDir, 'index.m3u8'), { force: true }).catch(() => {});
      setTimeout(() => jobs.get(hash) === job && jobs.delete(hash), 120_000);
    } finally {
      hlsEncodeSemaphore.release();
    }
  })();

  // The IIFE above runs synchronously up to its first await, so if this job had
  // to queue it is already registered by the time we read the position here.
  return { status: 'transcoding', progress: 0, queuePosition: getHlsQueuePosition(hash) };
}

/**
 * Drive ffmpeg until the rendition is complete. Holds the encode slot the whole
 * time, including across restarts and the VAAPI→libx264 fallback, so a seek
 * never sends the job to the back of the queue.
 *
 * Stream-copy (non-seekable) jobs are one ffmpeg run from 0 to the end.
 * Seekable jobs are a series of runs, each covering one gap: from a start
 * segment up to the next segment already on disk (or the end). A seek ends the
 * current run and starts one at the requested segment; when a run finishes,
 * the next gap after it is filled, wrapping around to the start, until none
 * remain.
 */
async function runJob(ctx, hwaccel, firstSegment) {
  const { job, hash, hlsDir, fullPath, jobId, durationSecs } = ctx;
  const totalSegments = job.seekable ? Math.ceil(durationSecs / HLS_SEG_DURATION) : null;

  // Segments ffmpeg was started at and could not produce — a container
  // duration that overstates the streams. Treated as done so the gap-filler
  // cannot retry them forever.
  job.unreachable = new Set();

  let from = firstSegment;
  let resumeAfter = firstSegment ?? 0;

  while (true) {
    let stopAt = null;
    let doneBefore = 0;
    if (job.seekable) {
      const present = await listSegments(hlsDir);
      if (job.seekTo != null) {
        from = job.seekTo;
        job.seekTo = null;
      }
      if (from == null) from = nextMissing(present, job.unreachable, resumeAfter, totalSegments);
      if (from == null) break; // every segment is on disk
      // Run up to the next segment that already exists — re-encoding it would
      // be wasted work, and replacing a segment a player may be reading is
      // not free either.
      stopAt = from + 1;
      while (stopAt < totalSegments && !present.has(stopAt)) stopAt++;
      doneBefore = present.size + job.unreachable.size;
    }

    const result = await runFfmpeg(ctx, { hwaccel, from, stopAt, totalSegments, doneBefore });

    if (isCancelled(jobId)) {
      logger.info('hlsManager: HLS transcode cancelled', { fullPath });
      // Evict now so reopening the video starts a fresh job instead of reading
      // as failed. SIGTERM lets ffmpeg write its trailer, which on the
      // stream-copy path stamps index.m3u8 complete; the next job's start-up
      // clears the segments either way.
      jobs.delete(hash);
      if (!job.seekable) await rm(join(hlsDir, 'index.m3u8'), { force: true }).catch(() => {});
      return;
    }

    if (job.preempted) {
      // Everything on disk is complete — the watchdog SIGKILLs, so the segment
      // in flight never left its .tmp — and the marker lets the next start
      // keep it. Evict so reopening the video starts that next job.
      await writeFile(join(hlsDir, RESUME_MARKER), resumeMarkerContent(ctx.maxHeight), 'utf8').catch(() => {});
      jobs.delete(hash);
      addJobLog(jobId, 'Stopped: no one was watching and another video was waiting', 'info');
      completeJob(jobId, false, 'Stopped while idle — resumes when the video is reopened');
      return;
    }

    if (result.seek) {
      from = null; // job.seekTo holds the target
      continue;
    }

    if (result.code !== 0) {
      if (hwaccel === 'vaapi') {
        logger.warn('hlsManager: VAAPI failed, retrying with software libx264', {
          fullPath,
          stderr: result.stderr.slice(-800),
        });
        addJobLog(jobId, 'VAAPI failed, retrying with software libx264', 'warn');
        hwaccel = 'none';
        job.speed = 0; // VAAPI's speed says nothing about libx264's
        if (job.seekable) {
          // What VAAPI finished before failing is valid; carry on from the gap.
          resumeAfter = from;
          from = null;
        } else {
          await clearSegmentsFrom(hlsDir, 0);
          await rm(join(hlsDir, 'index.m3u8'), { force: true });
        }
        continue;
      }
      throw new Error(result.stderr.slice(-800) || `ffmpeg exited with code ${result.code}`);
    }

    if (!job.seekable) break;

    // A clean exit that never wrote its first segment was started past the
    // end of the streams, and so is everything after it in this gap.
    try {
      await access(join(hlsDir, hlsSegmentName(from)));
    } catch {
      for (let i = from; i < stopAt; i++) job.unreachable.add(i);
      logger.warn('hlsManager: segments past the end of the streams', { fullPath, from, stopAt });
    }
    resumeAfter = stopAt;
    from = null;
  }

  if (job.seekable) {
    // Only the pre-written playlist describes every segment. Trim a tail that
    // ffmpeg could not produce so players do not wait on segments that will
    // never exist, then publish it as index.m3u8: the completion marker.
    let segments = totalSegments;
    while (segments > 0 && job.unreachable.has(segments - 1)) segments--;
    if (segments < totalSegments) await prewriteVodManifest(hlsDir, durationSecs, segments);
    const playlist = await readFile(join(hlsDir, 'playlist.m3u8'), 'utf8');
    await writeFile(join(hlsDir, 'index.m3u8'), playlist, 'utf8');
    await rm(join(hlsDir, RUN_PLAYLIST), { force: true }).catch(() => {});
    await clearSegmentsFrom(hlsDir, Infinity).catch(() => {}); // stray .tmp files
  }

  job.status = 'done';
  job.progress = 100;
  logger.info('hlsManager: HLS transcode complete', { fullPath });
  completeJob(jobId, true);
  // Auto-evict from map 2 minutes after completion
  setTimeout(() => jobs.get(hash) === job && jobs.delete(hash), 120_000);
}

/**
 * One ffmpeg process. Resolves when it exits, with `seek: true` if it was
 * killed by requestHlsSegment.
 */
function runFfmpeg(ctx, { hwaccel, from, stopAt, totalSegments, doneBefore }) {
  const { job, hlsDir, fullPath, codecs, jobId, durationSecs } = ctx;
  const startSegment = job.seekable ? from : 0;
  const startSecs = startSegment * HLS_SEG_DURATION;
  // Bounded so the run stops exactly where existing segments begin (-t cuts
  // on the segment boundary without emitting a partial trailing segment).
  const bounded = job.seekable && stopAt < totalSegments;

  const ffmpegArgs = buildHlsArgs(
    fullPath,
    join(hlsDir, job.seekable ? RUN_PLAYLIST : 'index.m3u8'),
    codecs.videoCodec,
    codecs.audioCodec,
    hwaccel,
    {
      maxHeight: ctx.maxHeight,
      sourceHeight: ctx.videoHeight,
      pixFmt: ctx.pixFmt,
      startSegment,
      maxSecs: bounded ? (stopAt - from) * HLS_SEG_DURATION : undefined,
      variant: ctx.variant,
    },
  );

  job.run = { from: startSegment, stopAt: job.seekable ? stopAt : Infinity };
  job.cursorSecs = startSecs;
  // job.speed is left from the previous run: same file, same encoder (unless
  // VAAPI just failed over), so it is a far better estimate than none.

  logger.info('hlsManager: starting HLS transcode', {
    fullPath,
    hlsDir,
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    pixFmt: ctx.pixFmt,
    sourceHeight: ctx.videoHeight,
    hwaccel,
    variant: ctx.variant,
    maxHeight: ctx.maxHeight ?? 'original',
    segments: job.seekable ? `${from}-${stopAt - 1} of ${totalSegments}` : 'all',
    ffmpegArgs: ffmpegArgs.join(' '),
  });

  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    // 'error' and 'close' can both fire for one process.
    const finish = (code) => {
      if (settled) return;
      settled = true;
      job.proc = null;
      resolve({ code, stderr, seek: job.seekTo != null });
    };

    let proc;
    try {
      proc = spawn('ffmpeg', ffmpegArgs, { cwd: hlsDir });
    } catch (err) {
      // Defensive: spawn() throwing synchronously is rare.
      stderr = err.message;
      finish(-1);
      return;
    }
    job.proc = proc;
    setJobChild(jobId, proc);
    let lastBroadcastProgress = -1;

    proc.stderr.on('data', (chunk) => {
      // Keep only the last 8 KB to prevent unbounded memory growth during long transcodes
      stderr = (stderr + chunk.toString()).slice(-8192);

      // Parse progress from "time=HH:MM:SS.ss" in FFmpeg stderr. It counts
      // from where this run started, not from the top of the file.
      const times = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/g);
      if (!times) return;
      const elapsed = parseTimeSeconds(times[times.length - 1].slice('time='.length));
      job.cursorSecs = startSecs + elapsed;
      const speeds = stderr.match(/speed=\s*[\d.]+x/g);
      if (speeds) job.speed = parseFloat(speeds[speeds.length - 1].replace(/speed=\s*/, ''));

      let progress;
      if (job.seekable) {
        const runSegments = Math.min(elapsed / HLS_SEG_DURATION, stopAt - from);
        progress = ((doneBefore + runSegments) / totalSegments) * 100;
      } else if (durationSecs > 0) {
        progress = (elapsed / durationSecs) * 100;
      } else {
        return;
      }
      job.progress = Math.min(99, Math.round(progress));
      // Broadcast every 5% to avoid flooding
      if (job.progress >= lastBroadcastProgress + 5) {
        lastBroadcastProgress = job.progress;
        setJobProgress(jobId, job.progress, true);
      }
    });

    proc.on('close', (code) => finish(code));
    proc.on('error', (err) => {
      stderr += err.message;
      logger.error('hlsManager: ffmpeg spawn error', { fullPath, error: err.message });
      finish(-1);
    });
  });
}
