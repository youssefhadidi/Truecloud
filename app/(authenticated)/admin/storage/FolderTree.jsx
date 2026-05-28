/** @format */

'use client';

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { List, AutoSizer } from 'react-virtualized';
import { FiFolder, FiLock, FiChevronDown, FiChevronRight } from 'react-icons/fi';

const ROW_HEIGHT = 44;
// Cap the panel; the List sizes to min(rows × ROW_HEIGHT, MAX_PANEL_HEIGHT).
const MAX_PANEL_HEIGHT = 'calc(100vh - 360px)';

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

// Depth-first flatten that skips descendants of collapsed nodes. Keeps render
// cost proportional to *visible* folders, not total folders.
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
  const listRef = useRef(null);

  // Defer the folders reference so the heavy buildChildIndex + flattenVisible
  // work runs at low priority. The status pill, ticker, and tab badges driven
  // by parent state stay snappy even while a huge tree is re-indexing.
  const deferredFolders = useDeferredValue(folders);

  const byParent = useMemo(() => buildChildIndex(deferredFolders), [deferredFolders]);
  const rows = useMemo(() => flattenVisible(byParent, collapsed), [byParent, collapsed]);
  const totalFolders = useMemo(() => Object.keys(deferredFolders).length, [deferredFolders]);

  // react-virtualized caches row contents — when the underlying data updates
  // (a folder's byte count grows mid-scan) the visible cells must repaint.
  // Same pattern as components/files/ListView.jsx.
  useEffect(() => {
    listRef.current?.forceUpdateGrid();
  }, [rows, lockedPaths]);

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
    for (const [path, children] of byParent.entries()) {
      if (path && children.length > 0) all.add(path);
    }
    setCollapsed(all);
  }, [byParent]);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  // Stable rowRenderer per row data + lockedPaths. Re-created when rows
  // change so the new closure sees the updated array.
  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const r = rows[index];
      const pct = r.parentMax > 0 ? (r.bytes / r.parentMax) * 100 : 0;
      const indent = r.depth * 16;
      return (
        <div
          key={key}
          style={style}
          className="flex items-center gap-2 px-3 border-b border-gray-800/60 hover:bg-gray-800/50"
        >
          <div className="shrink-0 flex items-center" style={{ paddingLeft: indent }}>
            {r.hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(r.path)}
                className="text-gray-500 hover:text-white p-0.5 -m-0.5"
                aria-label={r.collapsed ? 'Expand' : 'Collapse'}
              >
                {r.collapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
              </button>
            ) : (
              <span className="inline-block w-[14px]" />
            )}
          </div>
          {lockedPaths.has(r.path) ? (
            <FiLock className="text-yellow-400 shrink-0" size={14} />
          ) : (
            <FiFolder className="text-blue-400 shrink-0" size={14} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-200 truncate">{r.name}</span>
              <span className="text-xs text-gray-400 tabular-nums shrink-0">{formatBytes(r.bytes)}</span>
            </div>
            <div className="mt-1 h-1 rounded bg-gray-800 overflow-hidden">
              <div className="h-full bg-blue-500/70" style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%` }} />
            </div>
          </div>
        </div>
      );
    },
    [rows, lockedPaths, toggle],
  );

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
        <span className="text-gray-400 tabular-nums">
          {totalFolders.toLocaleString()} folders · {rows.length.toLocaleString()} visible
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={expandAll}
            className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50"
          >
            Collapse all
          </button>
        </div>
      </div>
      <div style={{ height: `min(${MAX_PANEL_HEIGHT}, ${rows.length * ROW_HEIGHT}px)`, minHeight: rows.length === 0 ? 0 : ROW_HEIGHT }}>
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              height={height}
              width={width}
              rowCount={rows.length}
              rowHeight={ROW_HEIGHT}
              rowRenderer={rowRenderer}
              overscanRowCount={10}
              style={{ outline: 'none' }}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
}
