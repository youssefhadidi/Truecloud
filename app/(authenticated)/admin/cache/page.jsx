/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { FiTrash2, FiRefreshCw, FiPlay, FiX, FiFolder, FiHardDrive } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function CachePage() {
  const [caches, setCaches] = useState([]);
  const [totalSize, setTotalSize] = useState('0 B');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(null);
  const [confirmClear, setConfirmClear] = useState(null);

  // Generate state
  const [generatePath, setGeneratePath] = useState('');
  const [generateType, setGenerateType] = useState('thumbnails');
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(null);
  const abortControllerRef = useRef(null);

  const { addNotification } = useNotifications();

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

  // Start generation
  const handleGenerate = async () => {
    if (generating) return;

    setGenerating(true);
    setGenerateProgress({ status: 'starting', processed: 0, total: 0 });

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/admin/cache/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: generatePath, type: generateType }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate cache');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              setGenerateProgress(data);

              if (data.status === 'complete') {
                addNotification(
                  'success',
                  `Generated ${data.successful} items, ${data.skipped} skipped, ${data.failed} failed in ${data.duration}s`
                );
                await fetchStats();
              } else if (data.status === 'error') {
                addNotification('error', data.message);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        addNotification('error', error.message);
      }
    } finally {
      setGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // Cancel generation
  const handleCancelGenerate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addNotification('info', 'Generation cancelled');
    }
  };

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
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Generate Cache</h2>

        <div className="space-y-4">
          {/* Path Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Target Path (leave empty for all files)</label>
            <div className="flex items-center gap-2">
              <FiFolder className="text-gray-500" />
              <input
                type="text"
                value={generatePath}
                onChange={(e) => setGeneratePath(e.target.value)}
                placeholder="e.g., user_abc123/photos"
                disabled={generating}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Type Selection */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Generate Type</label>
            <div className="flex flex-wrap gap-3">
              {[
                { value: 'thumbnails', label: 'Thumbnails' },
                { value: 'optimized', label: 'Optimized Images' },
                { value: 'stream', label: 'Video Streaming' },
                { value: 'all', label: 'All' },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                    generateType === option.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  } ${generating ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="generateType"
                    value={option.value}
                    checked={generateType === option.value}
                    onChange={(e) => setGenerateType(e.target.value)}
                    disabled={generating}
                    className="hidden"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiPlay />
              {generating ? 'Generating...' : 'Generate'}
            </button>
            {generating && (
              <button
                onClick={handleCancelGenerate}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
              >
                <FiX />
                Cancel
              </button>
            )}
          </div>

          {/* Progress */}
          {generateProgress && (
            <div className="mt-4 p-4 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-300">
                  {generateProgress.status === 'scanning' && 'Scanning directory...'}
                  {generateProgress.status === 'starting' && `Found ${generateProgress.total} files`}
                  {generateProgress.status === 'progress' && `Processing: ${generateProgress.current}`}
                  {generateProgress.status === 'complete' && 'Complete!'}
                  {generateProgress.status === 'error' && `Error: ${generateProgress.message}`}
                </span>
                {generateProgress.total > 0 && (
                  <span className="text-gray-400">
                    {generateProgress.processed}/{generateProgress.total}
                  </span>
                )}
              </div>

              {generateProgress.total > 0 && (
                <>
                  <div className="w-full bg-gray-600 rounded-full h-2 mb-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${(generateProgress.processed / generateProgress.total) * 100}%` }}
                    ></div>
                  </div>

                  <div className="flex gap-4 text-xs text-gray-400">
                    <span className="text-green-400">✓ {generateProgress.successful || 0} generated</span>
                    <span className="text-yellow-400">⊘ {generateProgress.skipped || 0} skipped</span>
                    <span className="text-red-400">✗ {generateProgress.failed || 0} failed</span>
                    {generateProgress.duration && (
                      <span className="ml-auto">{generateProgress.duration}s</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
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
    </>
  );
}
