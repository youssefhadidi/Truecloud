'use client';

import { useEffect, useState, useRef } from 'react';
import { FiRefreshCw, FiDownload } from 'react-icons/fi';
import { useLogsStream } from '@/hooks/useLogsStream';
import { useLogs } from '@/lib/api/logs';

export default function LogViewer() {
  const { logs, isLoading, error: streamError } = useLogsStream();
  const { refetch } = useLogs();
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState(null);
  const logsEndRef = useRef(null);

  // Sync error from stream hook
  useEffect(() => {
    if (streamError) {
      setError(streamError);
    }
  }, [streamError]);

  const scrollToBottom = () => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  // Manual refresh - re-fetch initial logs from API
  const refreshLogs = async () => {
    setError(null);
    try {
      await refetch();
    } catch (err) {
      setError('Failed to refresh logs');
      console.error('[LOGS] Error refreshing:', err);
    }
  };

  const downloadLogs = () => {
    const content = logs.join('\n');
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', `truecloud-logs-${new Date().toISOString()}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const clearLogs = () => {
    setError(null);
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">Live Logs</h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">{logs.length} lines loaded</p>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded text-xs sm:text-sm font-medium transition-colors ${
                autoScroll
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <span className="hidden sm:inline">{autoScroll ? '📍 Auto-scroll ON' : '📍 Auto-scroll OFF'}</span>
              <span className="sm:hidden">📍</span>
            </button>
            <button
              onClick={refreshLogs}
              disabled={isLoading}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500"
              title="Refresh"
            >
              <FiRefreshCw className={isLoading ? 'animate-spin' : ''} size={16} />
              <span className="hidden sm:inline text-sm">Refresh</span>
            </button>
            <button
              onClick={downloadLogs}
              disabled={logs.length === 0}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500"
              title="Download"
            >
              <FiDownload size={16} />
              <span className="hidden sm:inline text-sm">Download</span>
            </button>
            <button
              onClick={clearLogs}
              disabled={logs.length === 0}
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-500 text-xs sm:text-sm font-medium"
              title="Clear View"
            >
              <span className="hidden sm:inline">Clear View</span>
              <span className="sm:hidden">Clear</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {error && (
          <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-xs sm:text-sm">
            <p className="font-semibold">Error loading logs:</p>
            <p>{error}</p>
          </div>
        )}

        <div className="bg-black rounded font-mono text-xs sm:text-sm text-green-400 p-3 sm:p-4 h-64 sm:h-80 lg:h-96 overflow-y-auto overflow-x-auto border border-gray-700">
          {logs.length === 0 ? (
            <div className="text-gray-500">
              {isLoading ? 'Loading logs...' : 'No logs available'}
            </div>
          ) : (
            <>
              {logs.map((log, index) => (
                <div key={index} className="whitespace-pre-wrap break-words text-xs min-w-fit">
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        <div className="mt-2 text-xs text-gray-400">
          <p>Logs stream in real-time via WebSocket</p>
        </div>
      </div>
    </div>
  );
}
