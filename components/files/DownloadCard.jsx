/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiPause, FiPlay, FiTrash2, FiDownload } from 'react-icons/fi';
import { useDownloadWebSocket } from '@/hooks/useDownloadWebSocket';

/**
 * DownloadCard - Displays a single download with real-time progress updates.
 *
 * Each instance subscribes directly to WebSocket messages for its gid,
 * ensuring independent, reliable real-time updates.
 */
export default function DownloadCard({
  gid,
  initialData = {},
  onPause,
  onResume,
  onRemove,
}) {
  const download = useDownloadWebSocket(gid, initialData);
  const [actionLoading, setActionLoading] = useState(false);

  const handlePause = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onPause?.(gid);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onResume?.(gid);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await onRemove?.(gid);
    } finally {
      setActionLoading(false);
    }
  };

  // Don't render completed or removed downloads
  if (download.status === 'complete' || download.status === 'removed') {
    return null;
  }

  return (
    <div className="group relative bg-gray-700 rounded-lg p-0 active:shadow-lg transition-shadow cursor-pointer flex flex-col h-full select-none" style={{ WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', overflow: 'clip' }}>
      {/* Thumbnail area with spinner */}
      <div className="w-full aspect-square flex items-center justify-center mb-2 bg-gray-600 relative overflow-hidden">
        {download.status === 'active' && (
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <div className="text-xs text-gray-300 font-medium">{Math.round(download.progress)}%</div>
          </div>
        )}

        {download.status === 'paused' && (
          <div className="flex flex-col items-center gap-2">
            <FiPlay className="text-yellow-400" size={24} />
            <div className="text-xs text-gray-300 font-medium">{Math.round(download.progress)}%</div>
          </div>
        )}

        {download.status === 'complete' && (
          <div className="flex flex-col items-center gap-2">
            <FiDownload className="text-green-400" size={24} />
            <div className="text-xs text-gray-300 font-medium">Done</div>
          </div>
        )}

        {(download.status === 'error' || download.status === 'removed') && (
          <div className="flex flex-col items-center gap-2">
            <FiTrash2 className="text-red-400" size={24} />
            <div className="text-xs text-gray-300 font-medium">{download.status === 'error' ? 'Error' : 'Removed'}</div>
          </div>
        )}

        {/* Progress bar at bottom */}
        {(download.status === 'active' || download.status === 'paused') && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(download.progress, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* File name */}
      <div className="font-medium text-white truncate px-1" title={download.name}>
        {download.name}
      </div>

      {/* Download size and progress */}
      <div className="text-xs text-gray-400 px-1 mt-auto">
        {download.downloadSpeed} · {Math.round(download.progress)}%
      </div>

      {/* Action buttons */}
      {(download.status === 'active' || download.status === 'paused') && (
        <div className="absolute top-2 right-2 flex gap-1 bg-gray-800 rounded-lg shadow-lg p-1 transition-opacity opacity-0 group-hover:opacity-100">
          {download.status === 'active' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePause();
              }}
              disabled={actionLoading}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Pause download"
            >
              <FiPause size={16} className="text-yellow-400" />
            </button>
          )}

          {download.status === 'paused' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleResume();
              }}
              disabled={actionLoading}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Resume download"
            >
              <FiPlay size={16} className="text-green-400" />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemove();
            }}
            disabled={actionLoading}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Remove download"
          >
            <FiTrash2 size={16} className="text-red-400" />
          </button>
        </div>
      )}
    </div>
  );
}
