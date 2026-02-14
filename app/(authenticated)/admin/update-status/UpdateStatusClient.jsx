'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { FiChevronDown, FiChevronUp, FiWifi, FiWifiOff } from 'react-icons/fi';

export default function UpdateStatusClient() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [expandedStep, setExpandedStep] = useState(null);

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
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!status) {
    return <div className="p-4 text-center text-gray-400">No status available</div>;
  }

  const currentStepIndex = status.steps.findIndex((s) => s.status === 'running');
  const completedSteps = status.steps.filter((s) => s.status === 'completed').length;
  const failedSteps = status.steps.filter((s) => s.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Main System Update Box with Status and Steps */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white mb-2">System Update</h1>
              <div className="flex items-center gap-2 mb-3">
                {connected ? (
                  <>
                    <FiWifi className="text-green-500" size={16} />
                    <span className="text-sm text-green-400">Connected</span>
                  </>
                ) : (
                  <>
                    <FiWifiOff className="text-red-500" size={16} />
                    <span className="text-sm text-red-400">Disconnected</span>
                  </>
                )}
              </div>

              {/* Timing Info */}
              {status.startTime && (
                <div className="text-sm text-gray-400">
                  <p>
                    Started {formatDistanceToNow(new Date(status.startTime), { addSuffix: true })}
                  </p>
                  {status.endTime && (
                    <p>
                      Duration: {Math.round((new Date(status.endTime) - new Date(status.startTime)) / 1000)}s
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Status Badge */}
            <div className="flex-shrink-0">
              {status.isRunning && (
                <div className="bg-blue-900/50 border border-blue-700 rounded-lg px-4 py-2">
                  <p className="text-sm font-medium text-blue-300">In Progress</p>
                </div>
              )}
              {status.success === true && (
                <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-2">
                  <p className="text-sm font-medium text-green-300">✓ Completed</p>
                </div>
              )}
              {status.success === false && (
                <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2">
                  <p className="text-sm font-medium text-red-300">✕ Failed</p>
                </div>
              )}
            </div>
          </div>

          {/* Progress Summary - Inline */}
          {status.isRunning && (
            <div className="mt-4 flex gap-4 text-sm">
              <div>
                <p className="text-gray-500">Completed:</p>
                <p className="text-green-400 font-semibold">{completedSteps}/{status.steps.length}</p>
              </div>
              <div>
                <p className="text-gray-500">Current:</p>
                <p className="text-blue-400 font-semibold">
                  {currentStepIndex >= 0 ? status.steps[currentStepIndex].label : '—'}
                </p>
              </div>
              {failedSteps > 0 && (
                <div>
                  <p className="text-gray-500">Failed:</p>
                  <p className="text-red-400 font-semibold">{failedSteps}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Update Steps Timeline */}
        <div className="p-6">
          {/* Steps Timeline */}
          <div className="space-y-4">
            {status.steps.map((step, index) => (
            <div key={step.name} className="relative">
              {/* Connector Line */}
              {index < status.steps.length - 1 && (
                <div
                  className={`absolute left-6 top-12 w-1 h-6 ${
                    step.status === 'completed'
                      ? 'bg-green-500'
                      : step.status === 'failed'
                        ? 'bg-red-500'
                        : step.status === 'running'
                          ? 'bg-blue-500'
                          : 'bg-gray-600'
                  }`}
                />
              )}

              {/* Step Card */}
              <div className="relative flex gap-4">
                {/* Status Circle */}
                <div className="flex-shrink-0 pt-1">
                  <StepCircle status={step.status} isRunning={step.status === 'running'} />
                </div>

                {/* Step Content */}
                <div
                  className="flex-1 bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden hover:border-gray-500 transition-colors"
                  onClick={() => setExpandedStep(expandedStep === step.name ? null : step.name)}
                >
                  <div className="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div className="flex-1">
                      <p className="font-medium text-white">{step.label}</p>
                      {step.status === 'running' && (
                        <p className="text-xs text-blue-400 mt-1">Currently executing...</p>
                      )}
                      {step.status === 'completed' && step.endTime && step.startTime && (
                        <p className="text-xs text-green-400 mt-1">
                          Completed in{' '}
                          {Math.round((new Date(step.endTime) - new Date(step.startTime)) / 1000)}
                          s
                        </p>
                      )}
                      {step.status === 'failed' && step.logs.some((l) => l.type === 'error') && (
                        <p className="text-xs text-red-400 mt-1">
                          {step.logs.find((l) => l.type === 'error')?.message}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={step.status} />
                      {step.logs.length > 0 && (
                        <div className="text-gray-400">
                          {expandedStep === step.name ? <FiChevronUp /> : <FiChevronDown />}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step Logs - Expandable */}
                  {expandedStep === step.name && step.logs.length > 0 && (
                    <div className="border-t border-gray-600 bg-black/20 max-h-64 overflow-y-auto">
                      <div className="p-3 space-y-1 font-mono text-xs">
                        {step.logs.map((log, idx) => (
                          <div
                            key={idx}
                            className={`${
                              log.type === 'error'
                                ? 'text-red-400'
                                : log.type === 'success'
                                  ? 'text-green-400'
                                  : log.type === 'info'
                                    ? 'text-blue-400'
                                    : 'text-gray-400'
                            }`}
                          >
                            {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            ))}
          </div>
        </div>
      </div>

      {/* Start Update Button */}
      {!status.isRunning && (
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/system/run-update', { method: 'POST' });
                if (!res.ok) throw new Error('Failed to start update');
              } catch (err) {
                setError(err.message);
              }
            }}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Start Update
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

function StepCircle({ status, isRunning }) {
  const baseClasses = 'w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0';

  switch (status) {
    case 'completed':
      return <div className={`${baseClasses} bg-green-500/20 border-2 border-green-500 text-green-400`}>✓</div>;
    case 'failed':
      return <div className={`${baseClasses} bg-red-500/20 border-2 border-red-500 text-red-400`}>✕</div>;
    case 'running':
      return (
        <div className={`${baseClasses} bg-blue-500/20 border-2 border-blue-500 text-blue-400 animate-pulse`}>
          →
        </div>
      );
    default:
      return <div className={`${baseClasses} bg-gray-600/20 border-2 border-gray-600 text-gray-400`}>—</div>;
  }
}

function StatusBadge({ status }) {
  const styles = {
    completed: 'bg-green-500/20 text-green-400 border border-green-500/50',
    failed: 'bg-red-500/20 text-red-400 border border-red-500/50',
    running: 'bg-blue-500/20 text-blue-400 border border-blue-500/50',
    pending: 'bg-gray-500/20 text-gray-400 border border-gray-500/50',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${styles[status] || styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
