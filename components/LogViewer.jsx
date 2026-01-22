'use client';

import { useEffect, useState, useRef } from 'react';
import { FiRefreshCw, FiDownload } from 'react-icons/fi';
import axios from 'axios';

export default function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  const scrollToBottom = () => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  const fetchLogs = async () => {
    try {
      setError(null);
      const response = await axios.get('/api/system/logs');
      
      if (response.data.success) {
        // Use allLines from history to maintain persistence
        setLogs(response.data.allLines || []);
        setIsLoading(false);
      } else {
        setError(response.data.error || 'Failed to load logs');
        setIsLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load logs');
      console.error('Error fetching logs:', err);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    
    // Refresh logs every 2 seconds
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

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
    setLogs([]);
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Live Logs</h2>
          <p className="text-sm text-gray-500 mt-1">{logs.length} lines loaded</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              autoScroll
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {autoScroll ? '📍 Auto-scroll ON' : '📍 Auto-scroll OFF'}
          </button>
          <button
            onClick={fetchLogs}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
          >
            <FiRefreshCw className={isLoading ? 'animate-spin' : ''} size={16} />
            Refresh
          </button>
          <button
            onClick={downloadLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
          >
            <FiDownload size={16} />
            Download
          </button>
          <button
            onClick={clearLogs}
            disabled={logs.length === 0}
            className="px-3 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:bg-gray-50 disabled:text-gray-400 text-sm font-medium"
          >
            Clear View
          </button>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            <p className="font-semibold">Error loading logs:</p>
            <p>{error}</p>
          </div>
        )}

        <div className="bg-gray-900 rounded font-mono text-sm text-green-400 p-4 h-96 overflow-y-auto border border-gray-700">
          {logs.length === 0 ? (
            <div className="text-gray-500">
              {isLoading ? 'Loading logs...' : 'No logs available'}
            </div>
          ) : (
            <>
              {logs.map((log, index) => (
                <div key={index} className="whitespace-pre-wrap break-words text-xs">
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        <div className="mt-2 text-xs text-gray-500">
          <p>Logs refresh automatically every 2 seconds</p>
        </div>
      </div>
    </div>
  );
}
