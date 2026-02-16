/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiTrash2, FiRefreshCw, FiDatabase, FiActivity } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useFileIndexing } from '@/hooks/useFileIndexing';
import { useFileIndexStats, useRebuildFileIndex, useClearFileIndex } from '@/lib/api/fileIndex';

export default function FileIndexClient() {
  const [indexRebuilding, setIndexRebuilding] = useState(false);
  const [confirmIndexClear, setConfirmIndexClear] = useState(false);

  const { addNotification } = useNotifications();
  const indexStatus = useFileIndexing();

  const { data: indexStats, isLoading: indexLoading, refetch } = useFileIndexStats();
  const rebuildMutation = useRebuildFileIndex();
  const clearMutation = useClearFileIndex();

  // Rebuild file index
  const handleRebuildIndex = () => {
    setIndexRebuilding(true);
    rebuildMutation.mutate(undefined, {
      onSuccess: () => addNotification('success', 'Index rebuild started'),
      onError: (error) => {
        addNotification('error', error.response?.data?.error || error.message);
        setIndexRebuilding(false);
      },
    });
  };

  // Clear file index
  const handleClearIndex = () => {
    clearMutation.mutate(undefined, {
      onSuccess: (data) => {
        addNotification('success', `Cleared ${data.deletedCount} index entries`);
        setConfirmIndexClear(false);
      },
      onError: (error) => {
        addNotification('error', error.response?.data?.error || error.message);
      },
    });
  };

  // Subscribe to file indexing status updates via hook
  useEffect(() => {
    if (indexStatus.done) {
      setIndexRebuilding(false);
      if (indexStatus.error) {
        addNotification('error', `Index rebuild failed: ${indexStatus.error}`);
      } else {
        addNotification('success', `Index rebuilt with ${indexStatus.total} entries`);
      }
    }
  }, [indexStatus.done, indexStatus.error, indexStatus.total, addNotification]);

  return (
    <div className="mt-8 pt-8 border-t border-gray-700">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-3">
        <FiDatabase className="text-blue-400" />
        File Index Management
      </h2>

      {/* Index Stats Card */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
        {indexLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : indexStats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-sm">Files Indexed</p>
                <p className="text-2xl font-bold text-white">{indexStats.totalFiles.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Directories Indexed</p>
                <p className="text-2xl font-bold text-white">{indexStats.totalDirs.toLocaleString()}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <FiActivity className={`${indexStats.watcherActive ? 'text-green-400' : 'text-red-400'}`} />
                <span className="text-sm text-gray-400">
                  Watcher: <span className="font-semibold">{indexStats.watcherActive ? 'Active' : 'Inactive'}</span>
                </span>
              </div>
              {indexStats.lastIndexed && (
                <p className="text-xs text-gray-500 mt-2">
                  Last indexed: {new Date(indexStats.lastIndexed).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-gray-400">Failed to load index stats</p>
        )}
      </div>

      {/* Index Progress (during rebuild) */}
      {indexRebuilding && (
        <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
          <p className="text-white text-sm font-medium mb-3">Rebuilding Index...</p>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{
                width:
                  indexStatus.total > 0
                    ? `${(indexStatus.processed / indexStatus.total) * 100}%`
                    : '0%',
              }}
            ></div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {indexStatus.processed.toLocaleString()} / {indexStatus.total.toLocaleString()} items
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleRebuildIndex}
          disabled={indexRebuilding || indexLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {indexRebuilding ? <FiRefreshCw className="animate-spin" /> : <FiRefreshCw />}
          {indexRebuilding ? 'Rebuilding...' : 'Rebuild Index'}
        </button>

        <button
          onClick={() => setConfirmIndexClear(true)}
          disabled={indexRebuilding || indexLoading}
          className="flex items-center gap-2 px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiTrash2 />
          Clear Index
        </button>

        <button
          onClick={() => refetch()}
          disabled={indexLoading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={indexLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Confirm Clear Index Modal */}
      {confirmIndexClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Clear File Index?</h3>
            <p className="text-gray-400 mb-4">
              This will delete all indexed file entries. The index will need to be rebuilt to enable search functionality.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmIndexClear(false)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleClearIndex}
                disabled={clearMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearMutation.isPending ? <FiRefreshCw className="animate-spin" /> : <FiTrash2 />}
                Clear Index
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
