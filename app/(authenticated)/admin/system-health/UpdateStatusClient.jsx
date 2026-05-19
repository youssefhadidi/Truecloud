/** @format */

'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from '@/lib/timeAgo';
import { FiWifi, FiWifiOff } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useUpdateStatus, useRunUpdate } from '@/lib/api/system';

const RELOAD_DELAY_MS = 1000;
const RELOAD_STEP_NAME = '__reload_frontend__';

export default function UpdateStatusClient() {
  const [status, setStatus] = useState(null);
  const [expandedStep, setExpandedStep] = useState(null);
  const [error, setError] = useState(null);
  const [reloadActive, setReloadActive] = useState(false);
  const [stickLogsToBottom, setStickLogsToBottom] = useState(true);
  const prevRunningRef = useRef(false);
  const logsContainerRef = useRef(null);
  const { connected, subscribe } = useWebSocket();

  const { data: initialStatus, isLoading } = useUpdateStatus();
  const runUpdateMutation = useRunUpdate();

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    return subscribe('update-status', (message) => {
      try {
        setStatus(message.payload);
      } catch (err) {
        console.error('Error processing update status message:', err);
      }
    });
  }, [subscribe]);

  // Detect backend completion and trigger frontend reload
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = !!status?.isRunning;
    prevRunningRef.current = isRunning;

    if (wasRunning && !isRunning && status?.success === true) {
      setReloadActive(true);
      const t = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [status?.isRunning, status?.success]);

  // Append synthetic reload step
  const allSteps = useMemo(() => {
    if (!status?.steps) return [];
    let reloadStatus = 'pending';
    if (reloadActive) reloadStatus = 'running';
    else if (status.success === true) reloadStatus = 'completed';
    return [
      ...status.steps,
      { name: RELOAD_STEP_NAME, label: 'Reload Frontend', status: reloadStatus, logs: [] },
    ];
  }, [status?.steps, status?.success, reloadActive]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!status) {
    return <div className="p-4 text-center text-gray-400">No status available</div>;
  }

  const runningStep = allSteps.find((s) => s.status === 'running');
  const failedStep = allSteps.find((s) => s.status === 'failed');
  const focusStep = runningStep || failedStep || null;

  const headlineLabel = (() => {
    if (runningStep) return runningStep.label;
    if (failedStep) return `${failedStep.label} — failed`;
    if (status.success === true) return 'All steps complete';
    return 'Idle';
  })();
  const headlineSub = (() => {
    if (runningStep) return reloadActive ? 'Reloading frontend in a moment…' : 'Currently executing…';
    if (failedStep) return 'Expand the failed step below to see logs.';
    if (status.success === true) return null;
    if (status.startTime && !status.isRunning) return 'Run an update to begin.';
    return null;
  })();

  const visibleStep = expandedStep
    ? allSteps.find((s) => s.name === expandedStep)
    : focusStep;

  // Re-stick to bottom whenever the user changes which step they're viewing
  useEffect(() => {
    setStickLogsToBottom(true);
  }, [visibleStep?.name]);

  // Auto-scroll the logs panel to the bottom on new entries (if user is sticking to bottom)
  useEffect(() => {
    if (!stickLogsToBottom) return;
    const el = logsContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleStep?.name, visibleStep?.logs?.length, stickLogsToBottom]);

  const handleLogsScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setStickLogsToBottom(nearBottom);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">System Update</h2>
            <div className="flex items-center gap-2">
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
            {status.startTime && (
              <div className="text-sm text-gray-400 mt-2">
                <p>Started {formatDistanceToNow(new Date(status.startTime), { addSuffix: true })}</p>
                {status.endTime && (
                  <p>
                    Duration: {Math.round((new Date(status.endTime) - new Date(status.startTime)) / 1000)}s
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0">
            {status.isRunning && (
              <div className="bg-blue-900/50 border border-blue-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-blue-300">In Progress</p>
              </div>
            )}
            {!status.isRunning && status.success === true && (
              <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-green-300">✓ Completed</p>
              </div>
            )}
            {!status.isRunning && status.success === false && (
              <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-red-300">✕ Failed</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stepper + current step */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="overflow-x-auto">
          <div className="flex items-center min-w-fit">
            {allSteps.map((step, i) => (
              <Fragment key={step.name}>
                <button
                  type="button"
                  onClick={() => setExpandedStep(expandedStep === step.name ? null : step.name)}
                  className="flex-shrink-0"
                  title={step.label}
                  aria-label={step.label}
                >
                  <StepCircle
                    status={step.status}
                    index={i + 1}
                    active={(expandedStep ?? focusStep?.name) === step.name}
                  />
                </button>
                {i < allSteps.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-1 rounded min-w-[20px] ${
                      step.status === 'completed'
                        ? 'bg-green-500'
                        : step.status === 'failed'
                        ? 'bg-red-500'
                        : step.status === 'running'
                        ? 'bg-blue-500/60'
                        : 'bg-gray-600'
                    }`}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>

        {/* Current step text */}
        <div className="text-center mt-6 min-w-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Step</p>
          <p className="text-xl font-semibold text-white break-words">{headlineLabel}</p>
          {headlineSub && (
            <p
              className={`text-xs mt-1 break-words ${
                runningStep ? 'text-blue-400 animate-pulse' : failedStep ? 'text-red-400' : 'text-gray-400'
              }`}
            >
              {headlineSub}
            </p>
          )}
        </div>
      </div>

      {/* Logs panel for selected/active step */}
      {visibleStep && visibleStep.logs && visibleStep.logs.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <p className="text-sm text-white font-medium">{visibleStep.label} — Logs</p>
            <StatusBadge status={visibleStep.status} />
          </div>
          <div
            ref={logsContainerRef}
            onScroll={handleLogsScroll}
            className="max-h-72 overflow-y-auto p-3 space-y-1 font-mono text-xs bg-black/20"
          >
            {visibleStep.logs.map((log, idx) => (
              <div
                key={idx}
                className={`whitespace-pre-wrap break-all ${
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

      {/* Start Update Button */}
      {!status.isRunning && !reloadActive && (
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try {
                setError(null);
                await runUpdateMutation.mutateAsync();
              } catch (err) {
                setError(err.response?.data?.error || err.message || 'Failed to start update');
              }
            }}
            disabled={runUpdateMutation.isPending}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
          >
            {runUpdateMutation.isPending ? 'Starting...' : 'Start Update'}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

function StepCircle({ status, index, active }) {
  const base =
    'w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all';
  let style;
  switch (status) {
    case 'completed':
      style = 'bg-green-500/20 border-green-500 text-green-400';
      break;
    case 'failed':
      style = 'bg-red-500/20 border-red-500 text-red-400';
      break;
    case 'running':
      style = 'bg-blue-500/20 border-blue-500 text-blue-400 animate-pulse';
      break;
    default:
      style = 'bg-gray-700 border-gray-600 text-gray-400';
  }
  const ring = active ? 'ring-2 ring-blue-400/60 ring-offset-2 ring-offset-gray-800' : '';

  let content;
  if (status === 'completed') content = '✓';
  else if (status === 'failed') content = '✕';
  else content = index;

  return <div className={`${base} ${style} ${ring}`}>{content}</div>;
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
