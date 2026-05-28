/** @format */

import { readdir, stat } from 'fs/promises';
import { join, relative, extname } from 'path';
import { EventEmitter } from 'events';
import { categorize } from './storageCategories.js';

// Match the file-index worker so the same paths are ignored from both views.
const IGNORED = ['.thumbnails', 'opti-cache', '.stream-cache', '.cache', 'node_modules', 'iocage', 'clientmqueue'];

// Folders beyond this depth still contribute bytes to their depth-N ancestor,
// but aren't tracked as individual rows. Keeps the snapshot small for any
// tree size; the admin UI can still drill in via breadcrumb up to this depth.
const MAX_TRACKED_DEPTH = 4;

const FLUSH_MS = 200;

export function createScanner(root, signal) {
  const ee = new EventEmitter();
  const folders = Object.create(null); // path -> bytes (cumulative, depth ≤ MAX_TRACKED_DEPTH)
  const categories = {}; // name -> {bytes, count}
  let filesScanned = 0;
  let totalBytes = 0;
  let currentPath = '';
  let lastFlush = 0;
  let aborted = false;

  signal?.addEventListener?.('abort', () => { aborted = true; });

  function addToAncestors(relDir, size) {
    if (!relDir) return; // root files don't have a folder to attribute to
    const parts = relDir.split('/');
    const limit = Math.min(parts.length, MAX_TRACKED_DEPTH);
    for (let i = 0; i < limit; i++) {
      const p = parts.slice(0, i + 1).join('/');
      folders[p] = (folders[p] || 0) + size;
    }
  }

  function snapshot() {
    return {
      event: 'progress',
      folders: { ...folders },
      categories: JSON.parse(JSON.stringify(categories)),
      filesScanned,
      currentPath,
      totalBytes,
    };
  }

  function flush(force) {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS) return;
    lastFlush = now;
    ee.emit('progress', snapshot());
  }

  async function walk(dir) {
    if (aborted) return;
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission / ENOENT — keep walking siblings
    }

    for (const item of items) {
      if (aborted) return;
      if (IGNORED.includes(item.name)) continue;
      if (item.isSymbolicLink()) continue;

      const full = join(dir, item.name);

      if (item.isDirectory()) {
        const rel = relative(root, full).replace(/\\/g, '/');
        currentPath = rel;
        // Pre-register the folder so empty/zero-byte dirs still show up in the tree.
        if (rel) {
          const parts = rel.split('/');
          const limit = Math.min(parts.length, MAX_TRACKED_DEPTH);
          for (let i = 0; i < limit; i++) {
            const p = parts.slice(0, i + 1).join('/');
            if (folders[p] === undefined) folders[p] = 0;
          }
        }
        await walk(full);
      } else if (item.isFile()) {
        try {
          const s = await stat(full);
          const size = s.size;
          const rel = relative(root, full).replace(/\\/g, '/');
          const relDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
          const ext = extname(item.name).slice(1).toLowerCase();
          const cat = categorize(ext);

          if (!categories[cat]) categories[cat] = { bytes: 0, count: 0 };
          categories[cat].bytes += size;
          categories[cat].count += 1;

          totalBytes += size;
          filesScanned += 1;
          addToAncestors(relDir, size);

          flush(false);
        } catch {
          // stat failed — skip
        }
      }
    }
  }

  // Kick off async; do not block the caller. Errors flow through the 'error' event.
  (async () => {
    const startedAt = Date.now();
    ee.emit('start', { event: 'start', root, startedAt });
    try {
      await walk(root);
      if (aborted) return; // no 'done' on abort
      flush(true);
      ee.emit('done', {
        event: 'done',
        totalBytes,
        filesScanned,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      if (!aborted) ee.emit('error', { event: 'error', message: err?.message || String(err) });
    }
  })();

  ee.snapshot = snapshot;
  return ee;
}
