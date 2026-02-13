'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function UpdateStatusClient() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Fetch initial status
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/system/update-status');
        if (!res.ok) throw new Error('Failed to fetch status');
        const data = await res.json();
        setStatus(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/update-status`);

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'status') {
          setStatus(message.payload);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setError('WebSocket connection error');
    };

    ws.onclose = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  if (loading) {
    return <div className="p-4">Loading update status...</div>;
  }

  if (!status) {
    return <div className="p-4">No status available</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm text-gray-500">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Update Status Summary */}
      {status.isRunning && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-900">Update in progress...</p>
        </div>
      )}

      {status.success === true && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm font-medium text-green-900">Update completed successfully!</p>
        </div>
      )}

      {status.success === false && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-900">Update failed</p>
          {status.error && <p className="text-sm text-red-800 mt-1">{status.error}</p>}
        </div>
      )}

      {/* Timing */}
      {status.startTime && (
        <div className="text-sm text-gray-600">
          <p>
            Started: {new Date(status.startTime).toLocaleString()}
            {' '}
            ({formatDistanceToNow(new Date(status.startTime), { addSuffix: true })})
          </p>
          {status.endTime && (
            <p>
              Completed: {new Date(status.endTime).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="space-y-3">
        <h3 className="font-semibold text-gray-900">Update Steps</h3>
        {status.steps.map((step) => (
          <div key={step.name} className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusIcon status={step.status} />
                <div>
                  <p className="font-medium text-gray-900">{step.label}</p>
                  <p className="text-xs text-gray-500">{step.name}</p>
                </div>
              </div>
              <StatusBadge status={step.status} />
            </div>

            {/* Step Logs */}
            {step.logs.length > 0 && (
              <div className="bg-white border-t">
                <div className="max-h-48 overflow-y-auto p-3">
                  <div className="space-y-1 font-mono text-xs">
                    {step.logs.map((log, idx) => (
                      <div
                        key={idx}
                        className={`
                          ${log.type === 'error' ? 'text-red-600' : ''}
                          ${log.type === 'success' ? 'text-green-600' : ''}
                          ${log.type === 'info' ? 'text-blue-600' : ''}
                          ${log.type === 'log' ? 'text-gray-700' : ''}
                        `}
                      >
                        {log.message}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step Timing */}
            {step.startTime && (
              <div className="bg-gray-50 border-t px-4 py-2 text-xs text-gray-500">
                {step.endTime ? (
                  <span>
                    Took{' '}
                    {(new Date(step.endTime) - new Date(step.startTime)) / 1000}
                    s
                  </span>
                ) : (
                  <span>Running...</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Start Update Button */}
      {!status.isRunning && (
        <div className="pt-4">
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/system/run-update', { method: 'POST' });
                if (!res.ok) throw new Error('Failed to start update');
              } catch (err) {
                setError(err.message);
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Start Update
          </button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }) {
  switch (status) {
    case 'completed':
      return <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</div>;
    case 'failed':
      return <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">✕</div>;
    case 'running':
      return <div className="w-5 h-5 rounded-full bg-blue-500 animate-pulse" />;
    default:
      return <div className="w-5 h-5 rounded-full bg-gray-300" />;
  }
}

function StatusBadge({ status }) {
  const styles = {
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    running: 'bg-blue-100 text-blue-800',
    pending: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
