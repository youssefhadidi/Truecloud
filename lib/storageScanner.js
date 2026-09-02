/** @format */

import { readdir, stat } from 'fs/promises';
import { join, relative, extname } from 'path';
import { EventEmitter } from 'events';
import { categorize } from './storageCategories.js';
import { shouldSkipScanEntry } from './cachePaths.mjs';

// Folders beyond this depth still contribute bytes to their depth-N ancestor,
// but aren't tracked as individual rows. Bounded so a pathological tree can't
// blow up the snapshot — 12 levels comfortably covers any real upload tree.
export const MAX_TRACKED_DEPTH = 12;

// Snapshot cadence. Slower than metrics on purpose: payloads carry the entire
// folder map so flushing too often wastes bandwidth on near-identical state.
const FLUSH_MS = 400;

export function createScanner(root, signal) {
  const ee = new EventEmitter();
  const folders = Object.create(null); // path -> bytes (cumulative, depth ≤ MAX_TRACKED_DEPTH)
  const categories = {}; // name -> {bytes, count}

  // Duplicate detection: two files are "duplicates" iff they share (name, size).
  // To keep memory in check we don't carry singletons in the duplicates structure
  // — they sit in `seenFiles` until a second match promotes them into `dupGroups`.
  const seenFiles = new Map(); // key -> first relative path
  const dupGroups = new Map(); // key -> { name, size, paths: string[] }

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
    // Build paths incrementally to avoid an O(N²) slice+join per file.
    let p = '';
    for (let i = 0; i < limit; i++) {
      p = i === 0 ? parts[0] : p + '/' + parts[i];
      folders[p] = (folders[p] || 0) + size;
    }
  }

  // Cached duplicates array — populated only when dupGroups changes between
  // flushes. Lets us emit the same array reference repeatedly when there are
  // no new duplicate groups since the last snapshot.
  let dupsCache = [];
  let dupsCacheVersion = -1;
  let dupGroupsVersion = 0;

  function snapshot() {
    if (dupGroupsVersion !== dupsCacheVersion) {
      dupsCache = Array.from(dupGroups.values());
      dupsCacheVersion = dupGroupsVersion;
    }
    // Emit shared references for folders/categories. The emit→broadcast→
    // JSON.stringify chain is synchronous, and the only path that re-reads
    // a stored snapshot (storageScanManager.lastSnapshot for late subscribers)
    // runs at an await boundary where state is already consistent. No copy
    // needed — the spread/deep-clone we used to do dominated the flush cost
    // on large trees.
    return {
      event: 'progress',
      folders,
      categories,
      duplicates: dupsCache,
      filesScanned,
      totalBytes,
      currentPath,
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
      if (item.isSymbolicLink()) continue;

      const full = join(dir, item.name);
      // Ignored names, plus any cache dir configured inside UPLOAD_DIR
      if (shouldSkipScanEntry(item.name, full)) continue;

      if (item.isDirectory()) {
        const rel = relative(root, full).replace(/\\/g, '/');
        currentPath = rel;
        if (rel) {
          const parts = rel.split('/');
          const limit = Math.min(parts.length, MAX_TRACKED_DEPTH);
          let p = '';
          for (let i = 0; i < limit; i++) {
            p = i === 0 ? parts[0] : p + '/' + parts[i];
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

          // Trash is excluded from duplicate matching — surfacing a user's
          // soft-deletes as duplicates of the original would just nag them
          // about files they already chose to remove.
          const inTrash = rel === 'trash' || rel.startsWith('trash/');
          if (!inTrash) {
            const dupKey = item.name + '|' + size;
            const existingGroup = dupGroups.get(dupKey);
            if (existingGroup) {
              existingGroup.paths.push(rel);
              // Mutating paths doesn't change the group set, so dupsCache
              // can keep pointing at the same array — JSON.stringify will
              // pick up the new path automatically.
            } else {
              const firstSeen = seenFiles.get(dupKey);
              if (firstSeen !== undefined) {
                seenFiles.delete(dupKey);
                dupGroups.set(dupKey, { name: item.name, size, paths: [firstSeen, rel] });
                dupGroupsVersion++;
              } else {
                seenFiles.set(dupKey, rel);
              }
            }
          }

          flush(false);
        } catch {
          // stat failed — skip
        }
      }
    }
  }

  (async () => {
    const startedAt = Date.now();
    ee.emit('start', { event: 'start', root, startedAt });
    try {
      await walk(root);
      if (aborted) return;
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
