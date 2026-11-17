/** @format */

/**
 * HEIC/HEIF resizing through the libvips CLI (`vips thumbnail`) in a child
 * process, instead of sharp inside the server.
 *
 * WHY THIS EXISTS:
 * In-process, concurrent HEIC decodes under Bun segfault the whole server, so
 * server.js pins libvips/libde265 to one thread. That made every HEIC decode
 * single-threaded and slow. In a child process a native crash only kills that
 * one job, so it can use several threads. `vips thumbnail` also uses the HEIF's
 * embedded preview when it is at least the target size, which makes grid
 * thumbnails nearly free.
 *
 * Callers fall back to sharp only when the vips binary is missing (dev
 * machines). If vips ran and failed, they must NOT retry in-process: that
 * would reintroduce the crash this avoids.
 *
 * Dependency-free (relative imports only): the cache worker imports it too.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import os from 'node:os';
import { extname } from 'node:path';
import { Semaphore } from './semaphore.mjs';

export const HEIF_EXTENSIONS = ['.heic', '.heif'];

const VIPS_BIN = process.env.VIPS_BIN || '/usr/local/bin/vips';
const TIMEOUT_MS = 120_000;
// `vips thumbnail` needs a target size; "no limit" with --size down keeps
// the original dimensions.
const NO_LIMIT = 100_000;

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
/** libvips/libde265 threads per vips process. */
const THREADS = clampInt(process.env.HEIF_VIPS_THREADS, 1, 64, Math.min(4, cpuCount));
/** vips processes at once, so concurrent decodes don't oversubscribe CPU/RAM. */
const MAX_PROCS = clampInt(process.env.HEIF_VIPS_MAX_PROCS, 1, 64, Math.max(2, Math.floor(cpuCount / THREADS)));

const triplet = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
const CHILD_ENV = {
  ...process.env,
  // Where the source-built libvips/libheif/libde265 live
  LD_LIBRARY_PATH: [`/usr/local/lib/${triplet}`, '/usr/local/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  VIPS_CONCURRENCY: String(THREADS),
  OMP_NUM_THREADS: String(THREADS),
};

// globalThis: Next bundles routes separately; one limiter for the process.
const state = (globalThis.__heifVips ??= { semaphore: new Semaphore(MAX_PROCS), available: null });

export function isHeif(name) {
  return HEIF_EXTENSIONS.includes(extname(name).toLowerCase());
}

function vipsAvailable() {
  if (process.env.HEIF_USE_VIPS === '0' || process.platform === 'win32') return Promise.resolve(false);
  return (state.available ??= access(VIPS_BIN, constants.X_OK).then(
    () => true,
    () => false,
  ));
}

/**
 * Resize a HEIC/HEIF into `output` (format from its extension: .webp / .jpg),
 * fitting inside width × height, never enlarging, EXIF-rotated, sRGB, no
 * metadata — the same result as the sharp pipelines it replaces.
 *
 * @param {string} input
 * @param {string} output - must end in .webp or .jpg
 * @param {{ width?: number, height?: number, quality: number, signal?: AbortSignal, onSpawn?: (proc) => (() => void) | void }} options
 *   signal drops the job while it is still queued for a vips slot (a process
 *   already running is left to finish). onSpawn lets the cache worker track
 *   the process for cancellation; it may return a cleanup function, called
 *   when the process exits.
 * @returns {Promise<boolean>} false if vips isn't installed (use sharp instead)
 * @throws if vips ran and failed — don't retry in-process — or AbortError
 */
export async function resizeHeifWithVips(input, output, { width, height, quality, signal, onSpawn }) {
  if (!(await vipsAvailable())) return false;

  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : NO_LIMIT;
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : NO_LIMIT;
  const q = clampInt(quality, 1, 100, 80);
  const args = [
    'thumbnail',
    // Explicit options so vips never reads trailing "[...]" of a filename as options
    `${input}[fail_on=none]`,
    `${output}[Q=${q},keep=none]`,
    String(w),
    '--height', String(h),
    '--size', 'down',
    '--export-profile', 'srgb',
  ];

  await state.semaphore.acquire(1, signal);
  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn(VIPS_BIN, args, { env: CHILD_ENV, stdio: ['ignore', 'ignore', 'pipe'] });
      const cleanup = onSpawn?.(proc);
      let stderr = '';
      let timedOut = false;
      let finished = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, TIMEOUT_MS);
      // 'error' and 'close' can both fire for one process; settle once.
      const finish = () => {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        if (typeof cleanup === 'function') cleanup();
        return true;
      };

      proc.stderr.on('data', (d) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      proc.on('error', (err) => {
        if (!finish()) return;
        if (err.code === 'ENOENT') {
          state.available = Promise.resolve(false);
          resolve(false);
        } else {
          reject(new Error(`vips spawn error: ${err.message}`));
        }
      });
      proc.on('close', (code, signal) => {
        if (!finish()) return;
        if (code === 0) return resolve(true);
        if (timedOut) return reject(new Error(`vips timed out after ${TIMEOUT_MS / 1000}s on ${input}`));
        reject(new Error(`vips thumbnail failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${stderr.trim()}`));
      });
    });
  } catch (err) {
    await unlink(output).catch(() => {});
    throw err;
  } finally {
    state.semaphore.release();
  }
}
