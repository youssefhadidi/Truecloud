/** @format */

'use client';

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { List, AutoSizer } from 'react-virtualized';
import { FiFolder, FiLock, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { prettifyTopSegment } from './userNames';
import { useTranslation } from '@/components/LanguageProvider';

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

// Depth-first flatten that only descends into expanded nodes. Keeps render
// cost proportional to *visible* folders, not total folders. Root-level
// children (depth 0) are always shown so the user has somewhere to start.
function flattenVisible(byParent, expanded) {
  const out = [];
  const rootMax = (byParent.get('') || []).reduce((m, c) => Math.max(m, c.bytes), 0);
  function visit(parent, depth, parentMax) {
    const children = byParent.get(parent) || [];
    for (const c of children) {
      const hasChildren = byParent.has(c.path) && byParent.get(c.path).length > 0;
      const isExpanded = expanded.has(c.path);
      out.push({ ...c, depth, parentMax, hasChildren, expanded: isExpanded });
      if (isExpanded && hasChildren) {
        const ownMax = byParent.get(c.path).reduce((m, x) => Math.max(m, x.bytes), 0);
        visit(c.path, depth + 1, ownMax);
      }
    }
  }
  visit('', 0, rootMax);
  return out;
}

export default function FolderTree({ folders, lockedPaths, usernames }) {
  const { t } = useTranslation();
  // Empty set = all collapsed. New folders discovered mid-scan default to
  // collapsed too, since they only appear in the rendered tree when their
  // ancestor is in this set.
  const [expanded, setExpanded] = useState(() => new Set());
  const listRef = useRef(null);

  // Defer the folders reference so the heavy buildChildIndex + flattenVisible
  // work runs at low priority. The status pill, ticker, and tab badges driven
  // by parent state stay snappy even while a huge tree is re-indexing.
  const deferredFolders = useDeferredValue(folders);

  const byParent = useMemo(() => buildChildIndex(deferredFolders), [deferredFolders]);
  const rows = useMemo(() => flattenVisible(byParent, expanded), [byParent, expanded]);
  const totalFolders = useMemo(() => Object.keys(deferredFolders).length, [deferredFolders]);

  // react-virtualized caches row contents — when the underlying data updates
  // (a folder's byte count grows mid-scan) the visible cells must repaint.
  // Same pattern as components/files/ListView.jsx.
  useEffect(() => {
    listRef.current?.forceUpdateGrid();
  }, [rows, lockedPaths, usernames]);

  const toggle = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set();
    for (const [path, children] of byParent.entries()) {
      if (path && children.length > 0) all.add(path);
    }
    setExpanded(all);
  }, [byParent]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // Stable rowRenderer per row data + lockedPaths. Re-created when rows
  // change so the new closure sees the updated array.
  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const r = rows[index];
      const pct = r.parentMax > 0 ? (r.bytes / r.parentMax) * 100 : 0;
      const indent = r.depth * 16;
      const interactive = r.hasChildren;
      // Only top-level rows can carry a `user_<id>` segment.
      const displayName = r.depth === 0 ? prettifyTopSegment(r.name, usernames) : r.name;
      const isUserFolder = r.depth === 0 && r.name !== displayName;
      const content = (
        <>
          <div className="shrink-0 flex items-center" style={{ paddingLeft: indent }}>
            {r.hasChildren ? (
              <span className="text-gray-500 inline-flex">
                {r.expanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
              </span>
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
              <span className="text-sm text-gray-200 truncate" title={isUserFolder ? r.name : undefined}>
                {displayName}
                {isUserFolder && <span className="ml-1.5 text-[10px] text-gray-500 uppercase tracking-wider">{t('adminStorage.userBadge')}</span>}
              </span>
              <span className="text-xs text-gray-400 tabular-nums shrink-0">{formatBytes(r.bytes)}</span>
            </div>
            <div className="mt-1 h-1 rounded bg-gray-800 overflow-hidden">
              <div className="h-full bg-blue-500/70" style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%` }} />
            </div>
          </div>
        </>
      );
      return interactive ? (
        <button
          key={key}
          type="button"
          onClick={() => toggle(r.path)}
          style={style}
          aria-expanded={r.expanded}
          className="flex items-center gap-2 px-3 border-b border-gray-800/60 hover:bg-gray-800/50 text-left w-full"
        >
          {content}
        </button>
      ) : (
        <div
          key={key}
          style={style}
          className="flex items-center gap-2 px-3 border-b border-gray-800/60"
        >
          {content}
        </div>
      );
    },
    [rows, lockedPaths, toggle, usernames, t],
  );

  if (totalFolders === 0) {
    return (
      <div className="text-sm text-gray-500 px-3 py-6 text-center">
        {t('adminStorage.waitingForFolders')}
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between text-xs">
        <span className="text-gray-400 tabular-nums">
          {t('adminStorage.foldersVisible', { total: totalFolders.toLocaleString(), visible: rows.length.toLocaleString() })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={expandAll}
            className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50"
          >
            {t('adminStorage.expandAll')}
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700/50"
          >
            {t('adminStorage.collapseAll')}
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
