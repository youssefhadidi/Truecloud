/** @format */

'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from '@/lib/timeAgo';
import { FiWifi, FiWifiOff } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useUpdateStatus, useRunUpdate, useCheckUpdates } from '@/lib/api/system';
import { useTranslation } from '@/components/LanguageProvider';

export default function UpdateStatusClient() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [expandedStep, setExpandedStep] = useState(null);
  const [error, setError] = useState(null);
  const [pendingTarget, setPendingTarget] = useState(null);
  const [stickLogsToBottom, setStickLogsToBottom] = useState(true);
  const logsContainerRef = useRef(null);
  const { connected, subscribe } = useWebSocket();

  const { data: initialStatus, isLoading } = useUpdateStatus();
  const { data: updateInfo } = useCheckUpdates(true);
  const runUpdateMutation = useRunUpdate();
  const torrentService = updateInfo?.torrentService;

  const startUpdate = async (target) => {
    try {
      setError(null);
      setPendingTarget(target);
      await runUpdateMutation.mutateAsync(target);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('adminHealth.startUpdateFailed'));
    } finally {
      setPendingTarget(null);
    }
  };

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

  const allSteps = useMemo(() => status?.steps ?? [], [status?.steps]);

  const runningStep = allSteps.find((s) => s.status === 'running');
  const failedStep = allSteps.find((s) => s.status === 'failed');
  const focusStep = runningStep || failedStep || null;

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!status) {
    return <div className="p-4 text-center text-gray-400">{t('adminHealth.noStatus')}</div>;
  }

  const headlineLabel = (() => {
    if (runningStep) return runningStep.label;
    if (failedStep) return t('adminHealth.failedSuffix', { label: failedStep.label });
    if (status.success === true) return t('adminHealth.allStepsComplete');
    return t('adminHealth.idle');
  })();
  const headlineSub = (() => {
    if (runningStep) return t('adminHealth.currentlyExecuting');
    if (failedStep) return t('adminHealth.expandFailedStep');
    if (status.success === true) return null;
    if (status.startTime && !status.isRunning) return t('adminHealth.runUpdateToBegin');
    return null;
  })();

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
            <h2 className="text-2xl font-bold text-white mb-2">
              {status.targetLabel
                ? t('adminHealth.systemUpdateFor', { target: status.targetLabel })
                : t('adminHealth.systemUpdate')}
            </h2>
            <div className="flex items-center gap-2">
              {connected ? (
                <>
                  <FiWifi className="text-green-500" size={16} />
                  <span className="text-sm text-green-400">{t('adminHealth.connected')}</span>
                </>
              ) : (
                <>
                  <FiWifiOff className="text-red-500" size={16} />
                  <span className="text-sm text-red-400">{t('adminHealth.disconnected')}</span>
                </>
              )}
            </div>
            {status.startTime && (
              <div className="text-sm text-gray-400 mt-2">
                <p>{t('adminHealth.startedAgo', { time: formatDistanceToNow(new Date(status.startTime), { addSuffix: true }) })}</p>
                {status.endTime && (
                  <p>
                    {t('adminHealth.duration', { seconds: Math.round((new Date(status.endTime) - new Date(status.startTime)) / 1000) })}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0">
            {status.isRunning && (
              <div className="bg-blue-900/50 border border-blue-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-blue-300">{t('adminHealth.inProgress')}</p>
              </div>
            )}
            {!status.isRunning && status.success === true && (
              <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-green-300">{t('adminHealth.completed')}</p>
              </div>
            )}
            {!status.isRunning && status.success === false && (
              <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2">
                <p className="text-sm font-medium text-red-300">{t('adminHealth.failed')}</p>
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
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('adminHealth.currentStep')}</p>
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
            <p className="text-sm text-white font-medium">{t('adminHealth.logsSuffix', { label: visibleStep.label })}</p>
            <StatusBadge status={visibleStep.status} t={t} />
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

      {/* Start Update Buttons — the app and torrent-service are separate
          checkouts and are updated independently. */}
      {!status.isRunning && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => startUpdate('app')}
            disabled={runUpdateMutation.isPending}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
          >
            {pendingTarget === 'app' ? t('adminHealth.starting') : t('adminHealth.startUpdate')}
          </button>
          <button
            onClick={() => startUpdate('torrent-service')}
            disabled={runUpdateMutation.isPending || torrentService?.available === false}
            title={torrentService?.available === false ? torrentService.message : undefined}
            className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 hover:bg-gray-600 transition-colors font-medium disabled:opacity-50"
          >
            {pendingTarget === 'torrent-service'
              ? t('adminHealth.starting')
              : t('adminHealth.startUpdateTorrentService')}
            {torrentService?.hasUpdate && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-300 border border-blue-500/50">
                {t('adminHealth.updateAvailableBadge')}
              </span>
            )}
          </button>
        </div>
      )}

      {torrentService?.available === false && (
        <p className="text-xs text-gray-400">
          {t('adminHealth.torrentServiceNotFound')}
        </p>
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

function StatusBadge({ status, t }) {
  const styles = {
    completed: 'bg-green-500/20 text-green-400 border border-green-500/50',
    failed: 'bg-red-500/20 text-red-400 border border-red-500/50',
    running: 'bg-blue-500/20 text-blue-400 border border-blue-500/50',
    pending: 'bg-gray-500/20 text-gray-400 border border-gray-500/50',
  };
  const labels = {
    completed: t('adminHealth.statusCompleted'),
    failed: t('adminHealth.statusFailed'),
    running: t('adminHealth.statusRunning'),
    pending: t('adminHealth.statusPending'),
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${styles[status] || styles.pending}`}>
      {labels[status] || labels.pending}
    </span>
  );
}
