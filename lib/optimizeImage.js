/** @format */

import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { optiCachePath } from '@/lib/optiCache.mjs';
import { isHeif, resizeHeifWithVips } from '@/lib/heifVips.mjs';
import { Semaphore } from '@/lib/semaphore.mjs';
import { optimizedImageCache } from '@/lib/thumbnailCache';
import { OPTIMIZE_EXTENSIONS } from '@/lib/extensions';
import { VIEWER_IMAGE, OPTIMIZE_MIN_BYTES } from '@/lib/imageVariants.mjs';

/**
 * Optimized image variants, shared by both optimize-image routes and the
 * upload hook.
 *
 * WHY THIS EXISTS:
 * - Concurrent requests for one variant (the viewer's prefetch, then the
 *   viewer itself; a second tab; a share visitor) each ran their own decode.
 *   They now share one job per cache path.
 * - A prefetch the viewer moved past kept its place in the queue, so the
 *   photo on screen waited behind decodes nobody wanted. A job still queued
 *   when every request waiting on it has disconnected is dropped.
 * - Uploads now pre-generate the viewer variant in the background; an
 *   on-demand request takes over a background job that hasn't started yet
 *   instead of queueing behind the upload backlog.
 *
 * globalThis: the app routes and the pages-router upload handlers are bundled
 * separately; they must share one limiter and one in-flight map.
 */
const state = (globalThis.__optimizeImage ??= {
  // Concurrent optimizations (HEIC ones are further capped in lib/heifVips.mjs)
  semaphore: new Semaphore(10),
  // Upload-triggered jobs hold at most this many of the slots above
  backgroundSemaphore: new Semaphore(1),
  // cachePath -> job
  jobs: new Map(),
});

const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';

// Keyed on the file's own name (from its path: the share route's `file`
// parameter can carry folders) so every caller derives the same key.
function cachePathFor(filePath, st, variant) {
  return optiCachePath(resolve(process.cwd(), OPTI_CACHE_DIR), basename(filePath), st, variant);
}

/**
 * Encode `filePath` as `variant` into `cachePath` (atomically) and return the
 * bytes. HEIC/HEIF go to out-of-process vips; everything else (or HEIF when
 * vips isn't installed) to sharp.
 */
async function produce(cachePath, { filePath, variant }, signal) {
  const { width, height, format } = variant;
  // format=jpeg is the "download as JPEG" path: always full quality
  const quality = format === 'jpeg' ? 100 : variant.quality;
  const tmpPath = `${cachePath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp.${format === 'jpeg' ? 'jpg' : 'webp'}`;

  await mkdir(dirname(cachePath), { recursive: true });
  try {
    const viaVips = isHeif(filePath) && (await resizeHeifWithVips(filePath, tmpPath, { width, height, quality, signal }));
    if (!viaVips) {
      let pipeline = sharp(filePath, { failOn: 'none', failOnError: false, limitInputPixels: false }).rotate();
      // 0x0 means keep the original size
      if (width || height) {
        pipeline = pipeline.resize(width || null, height || null, { fit: 'inside', withoutEnlargement: true });
      }
      pipeline = format === 'jpeg' ? pipeline.jpeg({ quality }) : pipeline.webp({ quality });
      await pipeline.toFile(tmpPath);
    }
    const buffer = await readFile(tmpPath);
    // Renamed into place so a concurrent reader never sees a half-written file
    await rename(tmpPath, cachePath);
    return buffer;
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function startJob(cachePath, input, background) {
  const controller = new AbortController();
  const job = { background, started: false, waiters: 0, controller, promise: null };
  const { signal } = controller;

  job.promise = (async () => {
    if (background) await state.backgroundSemaphore.acquire(1, signal);
    try {
      signal.throwIfAborted();
      await state.semaphore.acquire(1, signal);
      try {
        signal.throwIfAborted();
        job.started = true;
        return await produce(cachePath, input, signal);
      } finally {
        state.semaphore.release();
      }
    } finally {
      if (background) state.backgroundSemaphore.release();
    }
  })().finally(() => {
    if (state.jobs.get(cachePath) === job) state.jobs.delete(cachePath);
  });

  state.jobs.set(cachePath, job);
  return job;
}

/**
 * Count a request as waiting on `job`. When every waiting request has
 * disconnected, the job is aborted — which only drops it if it is still
 * queued; one already encoding finishes and fills the cache.
 */
function addWaiter(job, signal) {
  job.waiters++;
  if (!signal) return; // can't tell when it leaves: keeps the job alive
  const onAbort = () => {
    if (--job.waiters === 0) job.controller.abort();
  };
  if (signal.aborted) return onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  const cleanup = () => signal.removeEventListener('abort', onAbort);
  job.promise.then(cleanup, cleanup);
}

/**
 * The optimized `variant` of an image: from memory, disk, an in-flight job, or
 * a new one.
 *
 * @param {{ filePath: string, stat: import('fs').Stats,
 *   variant: { quality: number, width: number, height: number, format: 'webp' | 'jpeg' },
 *   signal?: AbortSignal }} options - signal: the request's, so a request that
 *   goes away stops holding a queued job alive
 * @returns {Promise<{ buffer: Buffer, cache: 'MEMORY' | 'HIT' | 'MISS' | 'ORIGINAL' }>}
 *   ORIGINAL: optimization failed and `buffer` is the source file — don't let
 *   clients cache it as the variant
 * @throws AbortError when the request went away while its job was queued
 */
export async function getOptimizedImage({ filePath, stat: st, variant, signal }) {
  const cachePath = cachePathFor(filePath, st, variant);

  const memoryCached = optimizedImageCache.get(cachePath);
  if (memoryCached) return { buffer: memoryCached, cache: 'MEMORY' };

  // The key covers the source's size and mtime, so a file found here was
  // made from the current version.
  try {
    const buffer = await readFile(cachePath);
    optimizedImageCache.set(cachePath, buffer);
    return { buffer, cache: 'HIT' };
  } catch {
    // Not cached yet
  }

  let job = state.jobs.get(cachePath);
  // Replace a job every waiter abandoned, or an upload job still queued
  // behind the upload backlog (it is skipped when its turn comes).
  if (job && (job.controller.signal.aborted || (job.background && !job.started))) {
    job.controller.abort();
    job = null;
  }
  job ??= startJob(cachePath, { filePath, variant }, false);
  addWaiter(job, signal);

  try {
    const buffer = await job.promise;
    optimizedImageCache.set(cachePath, buffer);
    return { buffer, cache: 'MISS' };
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Our own request went away — or, rarely, we joined a job just as its
      // last waiter left; retry once with a fresh job.
      if (signal?.aborted) throw err;
      return getOptimizedImage({ filePath, stat: st, variant, signal });
    }
    console.error('Image optimization failed, serving original:', err);
    return { buffer: await readFile(filePath), cache: 'ORIGINAL' };
  }
}

/**
 * Pre-generate the viewer variant of a just-uploaded image, in the background:
 * at most one such job runs at a time, and a viewer request for the same
 * image takes the job over. Never throws.
 * @param {string} filePath
 */
export async function pregenerateViewerImage(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.svg' || !OPTIMIZE_EXTENSIONS.includes(ext)) return;
  try {
    const st = await stat(filePath);
    // Small files are served as-is by the optimize-image routes
    if (st.size < OPTIMIZE_MIN_BYTES) return;
    const cachePath = cachePathFor(filePath, st, VIEWER_IMAGE);
    if (state.jobs.has(cachePath)) return;
    try {
      await stat(cachePath);
      return; // already cached
    } catch {}
    await startJob(cachePath, { filePath, variant: VIEWER_IMAGE }, true).promise;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('pregenerateViewerImage - failed', filePath, err?.message);
    }
  }
}
