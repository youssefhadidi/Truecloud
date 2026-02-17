/** @format */

'use client';

import { useState } from 'react';
import { FiPause, FiPlay, FiTrash2 } from 'react-icons/fi';
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

  return (
    <div className="relative overflow-hidden">
      {/* Download Item */}
      <div className="p-3 sm:p-4 border-b border-gray-700 last:border-b-0 hover:bg-gray-750 transition-colors">
        {/* Name and Status */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-medium text-gray-100 text-sm sm:text-base truncate flex-1">
            {download.name}
          </h3>
          <span
            className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
              download.status === 'active'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : download.status === 'paused'
                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                  : download.status === 'complete'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {download.status}
          </span>
        </div>

        {/* Progress Bar */}
        {(download.status === 'active' || download.status === 'paused') && (
          <div className="mb-2">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${Math.min(download.progress, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Download Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs sm:text-sm mb-3">
          <div>
            <p className="text-gray-500">Progress</p>
            <p className="text-gray-100 font-medium">{Math.round(download.progress)}%</p>
          </div>
          <div>
            <p className="text-gray-500">Speed</p>
            <p className="text-gray-100 font-medium">{download.downloadSpeed}</p>
          </div>
          {download.isTorrent && (
            <>
              <div>
                <p className="text-gray-500">Peers</p>
                <p className="text-gray-100 font-medium">{download.peers}</p>
              </div>
              <div>
                <p className="text-gray-500">Seeders</p>
                <p className="text-gray-100 font-medium">{download.seeders}</p>
              </div>
            </>
          )}
        </div>

        {/* Error Display */}
        {download.error && (
          <div className="mb-3 p-2 bg-red-900/20 border border-red-800 rounded text-red-400 text-xs">
            Error: {download.error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {download.status === 'active' && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-yellow-900/30 text-yellow-400 rounded text-xs sm:text-sm hover:bg-yellow-900/50 disabled:opacity-50 transition-colors"
              title="Pause download"
            >
              <FiPause size={14} />
              <span className="hidden sm:inline">Pause</span>
            </button>
          )}

          {download.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-green-900/30 text-green-400 rounded text-xs sm:text-sm hover:bg-green-900/50 disabled:opacity-50 transition-colors"
              title="Resume download"
            >
              <FiPlay size={14} />
              <span className="hidden sm:inline">Resume</span>
            </button>
          )}

          {(download.status === 'complete' || download.status === 'error' || download.status === 'removed') && (
            <span className="text-xs text-gray-500">
              {download.status === 'complete'
                ? 'Completed'
                : download.status === 'error'
                  ? 'Failed'
                  : 'Removed'}
            </span>
          )}

          <button
            onClick={handleRemove}
            disabled={actionLoading}
            className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-red-900/30 text-red-400 rounded text-xs sm:text-sm hover:bg-red-900/50 disabled:opacity-50 transition-colors ml-auto"
            title="Remove download"
          >
            <FiTrash2 size={14} />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </div>
      </div>
    </div>
  );
}
