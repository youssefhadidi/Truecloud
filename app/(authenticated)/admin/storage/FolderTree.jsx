/** @format */

'use client';

import { useMemo } from 'react';
import { FiFolder, FiLock } from 'react-icons/fi';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Group folder paths by their parent path. Each entry stays sorted by size
// descending so larger occupants surface first as the scan progresses.
function buildChildIndex(folders) {
  const byParent = new Map();
  byParent.set('', []);
  for (const path of Object.keys(folders)) {
    const idx = path.lastIndexOf('/');
    const parent = idx === -1 ? '' : path.slice(0, idx);
    const name = idx === -1 ? path : path.slice(idx + 1);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({ path, name, bytes: folders[path] });
  }
  for (const arr of byParent.values()) arr.sort((a, b) => b.bytes - a.bytes);
  return byParent;
}

// Depth-first flatten — always fully expanded.
function flattenAll(byParent) {
  const out = [];
  function visit(parent, depth, parentMax) {
    const children = byParent.get(parent) || [];
    for (const c of children) {
      out.push({ ...c, depth, parentMax });
      const grandkids = byParent.get(c.path);
      if (grandkids && grandkids.length > 0) {
        const ownMax = grandkids.reduce((m, x) => Math.max(m, x.bytes), 0);
        visit(c.path, depth + 1, ownMax);
      }
    }
  }
  const rootMax = (byParent.get('') || []).reduce((m, c) => Math.max(m, c.bytes), 0);
  visit('', 0, rootMax);
  return out;
}

export default function FolderTree({ folders, lockedPaths }) {
  const byParent = useMemo(() => buildChildIndex(folders), [folders]);
  const rows = useMemo(() => flattenAll(byParent), [byParent]);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-gray-500 px-3 py-6 text-center">
        Waiting for the scan to discover folders…
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 py-2 border-b border-gray-700/60 text-xs text-gray-400 tabular-nums">
        {rows.length.toLocaleString()} folders
      </div>
      <ul className="divide-y divide-gray-800/60 max-h-[calc(100vh-340px)] overflow-y-auto">
        {rows.map((r) => (
          <FolderRow key={r.path} row={r} isLocked={lockedPaths.has(r.path)} />
        ))}
      </ul>
    </div>
  );
}

function FolderRow({ row, isLocked }) {
  const pct = row.parentMax > 0 ? (row.bytes / row.parentMax) * 100 : 0;
  const indent = row.depth * 16;

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/50">
      <div className="shrink-0" style={{ paddingLeft: indent }} />
      {isLocked ? (
        <FiLock className="text-yellow-400 shrink-0" size={14} />
      ) : (
        <FiFolder className="text-blue-400 shrink-0" size={14} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-gray-200 truncate">{row.name}</span>
          <span className="text-xs text-gray-400 tabular-nums shrink-0">{formatBytes(row.bytes)}</span>
        </div>
        <div className="mt-1 h-1 rounded bg-gray-800 overflow-hidden">
          <div className="h-full bg-blue-500/70" style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%` }} />
        </div>
      </div>
    </li>
  );
}
