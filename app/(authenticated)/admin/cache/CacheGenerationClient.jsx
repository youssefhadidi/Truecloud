'use client';

import { useEffect, useState } from 'react';
import { FiPlay, FiX, FiFolder } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useGenerateCache, useStopCacheGeneration } from '@/lib/api/cache';

export default function CacheGenerationClient() {
  const [status, setStatus] = useState(null);
  const [generatePath, setGeneratePath] = useState('');
  const [generateType, setGenerateType] = useState('thumbnails');
  const [generating, setGenerating] = useState(false);
  const { connected, subscribe } = useWebSocket();

  const { addNotification } = useNotifications();
  const generateMutation = useGenerateCache();
  const stopMutation = useStopCacheGeneration();

  // Subscribe to cache-generation messages from unified WebSocket
  useEffect(() => {
    const unsubscribe = subscribe('cache-generation', (message) => {
      try {
        const payload = message.payload;
        setStatus(payload);
        setGenerating(payload.isRunning);

        if (payload.success === true) {
          addNotification(
            'success',
            `Generated ${payload.successful} items, ${payload.skipped} skipped, ${payload.failed} failed in ${payload.duration}s`
          );
        } else if (payload.success === false) {
          addNotification('error', payload.error || 'Cache generation failed');
        }
      } catch (err) {
        console.error('Error processing cache-generation message:', err);
      }
    });

    return unsubscribe;
  }, [subscribe, addNotification]);

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync({ path: generatePath, type: generateType });
      addNotification('info', 'Cache generation started');
    } catch (error) {
      addNotification('error', error.response?.data?.error || error.message);
    }
  };

  const handleStop = async () => {
    try {
      await stopMutation.mutateAsync();
      addNotification('info', 'Cache generation cancelled');
    } catch (error) {
      addNotification('error', error.response?.data?.error || error.message);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Generate Cache</h2>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

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

        {/* Generate/Stop Buttons */}
        <div className="flex items-center gap-3">
          {generating ? (
            <button
              onClick={handleStop}
              disabled={!connected}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiX />
              Cancel
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!connected}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiPlay />
              Generate
            </button>
          )}
        </div>

        {/* Status Display */}
        {status && (
          <div className="mt-4 space-y-4">
            {/* Current File */}
            {status.currentFile && (
              <div className="p-3 bg-gray-700 rounded-lg text-sm text-gray-300">
                <p className="font-mono truncate">📄 {status.currentFile}</p>
              </div>
            )}

            {/* Progress Bar */}
            {status.total > 0 && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">
                      {status.processed} / {status.total} files
                    </span>
                    <span className="text-sm text-gray-400">
                      {Math.round((status.processed / status.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-600 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(status.processed / status.total) * 100}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="bg-green-900/30 p-2 rounded text-green-400 text-center">
                    <p className="font-bold">{status.successful}</p>
                    <p>Generated</p>
                  </div>
                  <div className="bg-yellow-900/30 p-2 rounded text-yellow-400 text-center">
                    <p className="font-bold">{status.skipped}</p>
                    <p>Skipped</p>
                  </div>
                  <div className="bg-red-900/30 p-2 rounded text-red-400 text-center">
                    <p className="font-bold">{status.failed}</p>
                    <p>Failed</p>
                  </div>
                  <div className="bg-gray-700 p-2 rounded text-gray-300 text-center">
                    <p className="font-bold">{status.duration || '—'}</p>
                    <p>Seconds</p>
                  </div>
                </div>
              </>
            )}

            {/* Status Messages */}
            {status.success === true && (
              <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-400 text-sm">
                ✓ Cache generation completed successfully!
              </div>
            )}

            {status.success === false && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-400 text-sm">
                ✗ {status.error || 'Cache generation failed'}
              </div>
            )}

            {status.isRunning && !status.total && (
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3 text-blue-400 text-sm">
                🔍 Scanning files...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
