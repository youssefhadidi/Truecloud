/** @format */

'use client';

import { useMemo } from 'react';
import { FiFolder, FiLock, FiChevronRight } from 'react-icons/fi';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Given the full `folders` snapshot (Map of {path: bytes}, depth ≤ 4),
// return only the immediate children of `currentPath`.
function immediateChildren(folders, currentPath) {
  const prefix = currentPath ? currentPath + '/' : '';
  const depth = currentPath ? currentPath.split('/').length + 1 : 1;
  const children = [];
  for (const path of Object.keys(folders)) {
    if (currentPath && !path.startsWith(prefix)) continue;
    if (path === currentPath) continue;
    const segments = path.split('/');
    if (segments.length !== depth) continue;
    children.push({ path, name: segments[segments.length - 1], bytes: folders[path] });
  }
  children.sort((a, b) => b.bytes - a.bytes);
  return children;
}

export default function FolderTree({ folders, currentPath, onNavigate, lockedPaths, maxDepth }) {
  const children = useMemo(() => immediateChildren(folders, currentPath), [folders, currentPath]);
  const totalForView = useMemo(
    () => children.reduce((sum, c) => sum + c.bytes, 0),
    [children],
  );

  if (children.length === 0) {
    return (
      <div className="text-sm text-gray-500 px-3 py-6 text-center">
        {currentPath ? 'No subfolders here, or scan still loading…' : 'Waiting for first results…'}
      </div>
    );
  }

  const currentDepth = currentPath ? currentPath.split('/').length : 0;
  const atMaxDepth = currentDepth >= maxDepth;

  return (
    <ul className="divide-y divide-gray-800">
      {children.map((c) => {
        const isLocked = lockedPaths.has(c.path);
        const childDepth = currentDepth + 1;
        const canDrill = childDepth < maxDepth;
        const pct = totalForView > 0 ? (c.bytes / totalForView) * 100 : 0;
        return (
          <li key={c.path}>
            <button
              type="button"
              onClick={() => canDrill && onNavigate(c.path)}
              disabled={!canDrill}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                canDrill ? 'hover:bg-gray-800/70 cursor-pointer' : 'cursor-default opacity-90'
              }`}
            >
              {isLocked ? (
                <FiLock className="text-yellow-400 shrink-0" size={16} />
              ) : (
                <FiFolder className="text-blue-400 shrink-0" size={16} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-200 truncate">{c.name}</span>
                  <span className="text-xs text-gray-400 tabular-nums shrink-0">
                    {formatBytes(c.bytes)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-gray-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%` }}
                  />
                </div>
              </div>
              {canDrill && <FiChevronRight className="text-gray-500 shrink-0" size={16} />}
            </button>
          </li>
        );
      })}
      {atMaxDepth && (
        <li className="px-3 py-2 text-xs text-gray-500 italic">
          Drill-down limit reached (depth {maxDepth}). Deeper bytes are aggregated here.
        </li>
      )}
    </ul>
  );
}
