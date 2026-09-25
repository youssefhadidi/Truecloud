/** @format */

// Spreadsheet viewer payloads (see lib/xlsxPreviewParse.mjs), parsed off the
// main thread and cached.
//
// Parsing used to run inline in the route: a large workbook blocked the event
// loop for seconds, stalling every thumbnail, HLS segment and listing being
// served meanwhile, and it was redone on every open. Now one worker thread does
// the parsing (so concurrent opens can't saturate the CPU either), and results
// are kept, already JSON-encoded, keyed on the file's size and mtime.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildXlsxPreview } from './xlsxPreviewParse.mjs';

const CACHE_MAX_CHARS = 64 * 1024 * 1024;
// A workbook that takes longer than this is treated as hung: the worker is
// replaced so it can't hold up every later request.
const PARSE_TIMEOUT_MS = 60_000;

// key -> JSON string, in LRU order (Map iteration order = insertion order)
const cache = new Map();
let cacheChars = 0;
const inflight = new Map(); // key -> Promise<string>

function cacheGet(key) {
  const json = cache.get(key);
  if (json === undefined) return undefined;
  cache.delete(key);
  cache.set(key, json);
  return json;
}

function cacheSet(key, json) {
  if (json.length > CACHE_MAX_CHARS / 4) return; // one huge sheet shouldn't flush everything else
  while (cacheChars + json.length > CACHE_MAX_CHARS && cache.size > 0) {
    const [oldestKey, oldest] = cache.entries().next().value;
    cache.delete(oldestKey);
    cacheChars -= oldest.length;
  }
  cache.set(key, json);
  cacheChars += json.length;
}

// ── Worker ───────────────────────────────────────────────────────────────────

let activeWorker = null;
let workerUnsupported = false;
let nextId = 0;
const pending = new Map(); // id -> { resolve, reject, timer }

async function getWorker() {
  if (activeWorker) return activeWorker;
  // Imported at runtime and located from cwd, like the file-index worker, so
  // the bundler doesn't try to resolve the worker file.
  const { Worker } = await import('node:worker_threads');
  if (activeWorker) return activeWorker; // another caller started one meanwhile
  const worker = new Worker(join(process.cwd(), 'lib', 'workers', 'xlsxPreviewWorker.mjs'));
  worker.unref(); // never keeps the process alive on its own

  // Everything in flight was posted to this worker (a replacement is only
  // started once it is gone), so its failure fails all of them.
  const failAll = (err) => {
    if (activeWorker === worker) activeWorker = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };
  worker.on('message', ({ id, json, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    else p.resolve(json);
  });
  worker.on('error', (err) => {
    console.error('[xlsx preview] worker error:', err);
    failAll(err);
  });
  worker.on('exit', (code) => failAll(new Error(`xlsx preview worker exited (code ${code})`)));

  activeWorker = worker;
  return worker;
}

function parseInWorker(worker, filePath, sheetIndex) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    // terminate() fires 'exit', which rejects this and anything queued behind it
    const timer = setTimeout(() => worker.terminate(), PARSE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, filePath, sheetIndex });
  });
}

async function parse(filePath, sheetIndex) {
  if (!workerUnsupported) {
    let worker = null;
    try {
      worker = await getWorker();
    } catch (err) {
      // Only a runtime that can't start the worker falls back to parsing
      // inline. A workbook that crashes or hangs the worker is not retried on
      // the main thread: that is exactly the stall the worker is there to avoid.
      workerUnsupported = true;
      console.warn('[xlsx preview] worker thread unavailable, parsing inline:', err.message);
    }
    if (worker) return parseInWorker(worker, filePath, sheetIndex);
  }
  return JSON.stringify(await buildXlsxPreview(await readFile(filePath), sheetIndex));
}

/**
 * The viewer payload for one sheet, JSON-encoded.
 * @param {string} filePath Absolute path, already access-checked by the caller
 * @param {import('node:fs').Stats} stats The file's stats (they key the cache)
 * @param {number} sheetIndex
 * @returns {Promise<string>}
 */
export function getXlsxPreviewJson(filePath, stats, sheetIndex) {
  const key = `${filePath}\0${stats.size}\0${stats.mtimeMs}\0${sheetIndex}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return Promise.resolve(cached);

  let promise = inflight.get(key);
  if (!promise) {
    promise = parse(filePath, sheetIndex)
      .then((json) => {
        cacheSet(key, json);
        return json;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return promise;
}
