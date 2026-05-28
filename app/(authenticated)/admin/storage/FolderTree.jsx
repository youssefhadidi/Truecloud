/** @format */

'use client';

import { useMemo, useState, useCallback } from 'react';
import { FiFolder, FiLock, FiChevronDown, FiChevronRight } from 'react-icons/fi';

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

// Depth-first flatten that skips descendants of collapsed nodes. The result
// is a flat list of rows we can render in order — keeps render cost
// proportional to *visible* folders, not total folders.
function flattenVisible(byParent, collapsed) {
  const out = [];
  const rootMax = (byParent.get('') || []).reduce((m, c) => Math.max(m, c.bytes), 0);
  function visit(parent, depth, parentMax) {
    const children = byParent.get(parent) || [];
    for (const c of children) {
      const hasChildren = byParent.has(c.path) && byParent.get(c.path).length > 0;
      const isCollapsed = collapsed.has(c.path);
      out.push({ ...c, depth, parentMax, hasChildren, collapsed: isCollapsed });
      if (!isCollapsed && hasChildren) {
        const ownMax = byParent.get(c.path).reduce((m, x) => Math.max(m, x.bytes), 0);
        visit(c.path, depth + 1, ownMax);
      }
    }
  }
  visit('', 0, rootMax);
  return out;
}

export default function FolderTree({ folders, lockedPaths }) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const byParent = useMemo(() => buildChildIndex(folders), [folders]);
  const rows = useMemo(() => flattenVisible(byParent, collapsed), [byParent, collapsed]);

  const toggle = useCallback((path) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    const all = new Set();
    for (const path of Object.keys(folders)) {
      // Only collapse non-leaves to keep the set small
      if (byParent.has(path) && byParent.get(path).length > 0) all.add(path);
    }
    setCollapsed(all);
  }, [folders, byParent]);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  const totalFolders = Object.keys(folders).length;

  if (totalFolders === 0) {
    return (
      <div className="text-sm text-gray-500 px-3 py-6 text-center">
        Waiting for the scan to discover folders…
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between text-xs">
        <span className="text-gray-400 tabular-nums">{totalFolders.toLocaleString()} folders · {rows.length.toLocaleString()} visible</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={expandAll} className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50">Expand all</button>
          <button type="button" onClick={collapseAll} className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50">Collapse all</button>
        </div>
      </div>
      <ul className="divide-y divide-gray-800/60 max-h-[calc(100vh-340px)] overflow-y-auto">
        {rows.map((r) => (
          <FolderRow
            key={r.path}
            row={r}
            isLocked={lockedPaths.has(r.path)}
            onToggle={toggle}
          />
        ))}
      </ul>
    </div>
  );
}

function FolderRow({ row, isLocked, onToggle }) {
  const pct = row.parentMax > 0 ? (row.bytes / row.parentMax) * 100 : 0;
  const indent = row.depth * 16;

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/50">
      <div className="shrink-0 flex items-center" style={{ paddingLeft: indent }}>
        {row.hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(row.path)}
            className="text-gray-500 hover:text-white p-0.5 -m-0.5"
            aria-label={row.collapsed ? 'Expand' : 'Collapse'}
          >
            {row.collapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
          </button>
        ) : (
          <span className="inline-block w-[14px]" />
        )}
      </div>
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
