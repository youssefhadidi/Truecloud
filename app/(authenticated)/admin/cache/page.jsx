/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiTrash2, FiRefreshCw, FiHardDrive, FiDatabase, FiActivity } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import CacheGenerationClient from './CacheGenerationClient';

export default function CachePage() {
  const [caches, setCaches] = useState([]);
  const [totalSize, setTotalSize] = useState('0 B');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(null);
  const [confirmClear, setConfirmClear] = useState(null);

  // File Index state
  const [indexStats, setIndexStats] = useState(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexRebuilding, setIndexRebuilding] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ processed: 0, total: 0 });
  const [confirmIndexClear, setConfirmIndexClear] = useState(false);

  const { addNotification } = useNotifications();
  const { subscribe } = useWebSocket();

  // Fetch cache stats
  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/cache');
      if (!response.ok) throw new Error('Failed to fetch cache stats');
      const data = await response.json();
      setCaches(data.caches);
      setTotalSize(data.totalSizeFormatted);
    } catch (error) {
      addNotification('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Clear cache
  const handleClear = async (type) => {
    try {
      setClearing(type);
      const response = await fetch(`/api/admin/cache?type=${type}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to clear cache');
      const data = await response.json();
      addNotification('success', `Cleared ${data.filesDeleted} files (${data.freedSpaceFormatted})`);
      await fetchStats();
    } catch (error) {
      addNotification('error', error.message);
    } finally {
      setClearing(null);
      setConfirmClear(null);
    }
  };

  // Fetch file index stats
  const fetchIndexStats = async () => {
    try {
      setIndexLoading(true);
      const response = await fetch('/api/admin/file-index/stats');
      if (!response.ok) throw new Error('Failed to fetch index stats');
      const data = await response.json();
      setIndexStats(data);
    } catch (error) {
      addNotification('error', error.message);
    } finally {
      setIndexLoading(false);
    }
  };

  // Rebuild file index
  const handleRebuildIndex = async () => {
    try {
      setIndexRebuilding(true);
      setIndexProgress({ processed: 0, total: 0 });
      const response = await fetch('/api/admin/file-index/rebuild', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to start rebuild');
      addNotification('success', 'Index rebuild started');
    } catch (error) {
      addNotification('error', error.message);
      setIndexRebuilding(false);
    }
  };

  // Clear file index
  const handleClearIndex = async () => {
    try {
      const response = await fetch('/api/admin/file-index', {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to clear index');
      const data = await response.json();
      addNotification('success', `Cleared ${data.deletedCount} index entries`);
      await fetchIndexStats();
      setConfirmIndexClear(false);
    } catch (error) {
      addNotification('error', error.message);
    }
  };

  // Subscribe to WebSocket updates for file index rebuild
  useEffect(() => {
    const unsubscribe = subscribe('file-index', (message) => {
      if (message.type === 'progress') {
        setIndexProgress({ processed: message.processed, total: message.total });
      } else if (message.type === 'done') {
        setIndexRebuilding(false);
        addNotification('success', `Index rebuilt with ${message.total} entries`);
        fetchIndexStats();
      } else if (message.type === 'error') {
        setIndexRebuilding(false);
        addNotification('error', `Index rebuild failed: ${message.error}`);
      }
    });
    return unsubscribe;
  }, [subscribe, addNotification]);

  // Initial load
  useEffect(() => {
    fetchIndexStats();
  }, []);

  return (
    <>
      <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Cache Management</h1>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Total Size Card */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
        <div className="flex items-center gap-3">
          <FiHardDrive className="text-blue-400" size={24} />
          <div>
            <p className="text-gray-400 text-sm">Total Cache Size</p>
            <p className="text-2xl font-bold text-white">{totalSize}</p>
          </div>
          <button
            onClick={() => setConfirmClear('all')}
            disabled={clearing !== null}
            className="ml-auto px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            <FiTrash2 />
            <span className="hidden sm:inline">Clear All</span>
          </button>
        </div>
      </div>

      {/* Cache Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {loading ? (
          <div className="col-span-full flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          caches.map((cache) => (
            <div key={cache.type} className="bg-gray-800 rounded-lg shadow p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-white">{cache.name}</h3>
                  <p className="text-xs text-gray-500">{cache.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <div>
                  <p className="text-lg font-bold text-white">{cache.sizeFormatted}</p>
                  <p className="text-xs text-gray-400">{cache.fileCount.toLocaleString()} files</p>
                </div>
                <button
                  onClick={() => setConfirmClear(cache.type)}
                  disabled={clearing !== null || cache.fileCount === 0}
                  className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 disabled:opacity-50 flex items-center gap-1"
                >
                  {clearing === cache.type ? (
                    <FiRefreshCw className="animate-spin" size={14} />
                  ) : (
                    <FiTrash2 size={14} />
                  )}
                  <span>Clear</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Generate Section */}
      <CacheGenerationClient />

      {/* File Index Section */}
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
                    indexProgress.total > 0
                      ? `${(indexProgress.processed / indexProgress.total) * 100}%`
                      : '0%',
                }}
              ></div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {indexProgress.processed.toLocaleString()} / {indexProgress.total.toLocaleString()} items
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
            onClick={fetchIndexStats}
            disabled={indexLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
          >
            <FiRefreshCw className={indexLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Confirm Clear Modal */}
      {confirmClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Clear {confirmClear === 'all' ? 'All Caches' : caches.find((c) => c.type === confirmClear)?.name}?
            </h3>
            <p className="text-gray-400 mb-4">
              This will permanently delete all cached files. Thumbnails and optimized images will be regenerated on
              demand, but this may temporarily slow down file browsing.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmClear(null)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => handleClear(confirmClear)}
                disabled={clearing !== null}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearing && <FiRefreshCw className="animate-spin" />}
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
              >
                <FiTrash2 />
                Clear Index
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
