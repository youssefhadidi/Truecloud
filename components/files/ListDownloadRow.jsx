/** @format */

'use client';

import { useState } from 'react';
import { FiDownload, FiPause, FiPlay, FiX } from 'react-icons/fi';
import { useDownloadWebSocket } from '@/hooks/useDownloadWebSocket';

/**
 * ListDownloadRow - A download row for ListView with real-time WebSocket updates.
 * Each row independently subscribes to WebSocket messages for its specific download.
 */
export function ListDownloadRow({
  file,
  style,
  gridCols,
  selectionMode,
  selectedFiles,
  onToggleSelect,
  onPauseDownload,
  onResumeDownload,
  onRemoveDownload,
}) {
  const download = useDownloadWebSocket(file.downloadGid, {
    name: file.name,
    path: file.id?.replace('dl-', '') || '',
    progress: file.downloadProgress || 0,
    status: file.downloadStatus || 'active',
    downloadSpeed: file.downloadSpeed || '0 B/s',
    uploadSpeed: file.uploadSpeed || '0 B/s',
    seeders: file.seeders || 0,
    peers: file.peers || 0,
    isTorrent: file.isTorrent || false,
    error: file.error || null,
  });

  const [actionLoading, setActionLoading] = useState(false);

  const handlePause = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onPauseDownload?.(file.downloadGid);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onResumeDownload?.(file.downloadGid);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onRemoveDownload?.(file.downloadGid);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div
      style={{
        ...style,
        WebkitTapHighlightColor: 'transparent',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        position: 'relative',
      }}
      className={`left-0 w-full grid ${gridCols} gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-4 bg-yellow-900/10 border-b border-yellow-700 items-center select-none`}
    >
      {/* Progress bar at the bottom of the row */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
        <div
          className="h-full bg-yellow-500 transition-all"
          style={{ width: `${Math.min(download.progress, 100)}%` }}
        />
      </div>

      {/* Name and icon */}
      <div className="flex items-center gap-3 min-w-0">
        {selectionMode && (
          <input
            type="checkbox"
            checked={!!selectedFiles?.has(file.name)}
            onChange={() => onToggleSelect?.(file)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-500 bg-gray-800"
          />
        )}
        <div className="flex-shrink-0">
          {download.status === 'active' ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-yellow-500"></div>
          ) : (
            <FiDownload className="text-yellow-500" size={18} />
          )}
        </div>
        <div className="font-medium text-yellow-300 truncate">{download.name}</div>
      </div>

      {/* Progress percentage */}
      <div className="hidden sm:block text-yellow-300 text-sm">{Math.round(download.progress)}%</div>

      {/* Download speed */}
      <div className="hidden sm:block text-yellow-300 text-sm">{download.downloadSpeed}</div>

      {/* Action buttons - pause/resume and cancel */}
      <div className="flex justify-end gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (download.status === 'paused') {
              handleResume();
            } else {
              handlePause();
            }
          }}
          disabled={actionLoading}
          className="text-yellow-400 p-2 hover:bg-yellow-900/20 rounded disabled:opacity-50 transition-colors"
          title={download.status === 'paused' ? 'Resume' : 'Pause'}
        >
          {download.status === 'paused' ? <FiPlay size={18} /> : <FiPause size={18} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          disabled={actionLoading}
          className="text-red-400 p-2 hover:bg-red-900/20 rounded disabled:opacity-50 transition-colors"
          title="Cancel"
        >
          <FiX size={18} />
        </button>
      </div>
    </div>
  );
}
