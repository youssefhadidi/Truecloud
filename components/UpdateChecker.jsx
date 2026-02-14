/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import Confirm from '@/components/Confirm';
import { useCheckUpdates, useRunUpdate } from '@/lib/api/system';
import { useNotifications } from '@/contexts/NotificationsContext';
import { FiWifi, FiWifiOff } from 'react-icons/fi';

const DISMISSED_VERSION_KEY = 'update_dismissed_version';

export default function UpdateChecker() {
  const { data: updateInfo, isLoading } = useCheckUpdates(true); // Auto-check on first load
  const runUpdateMutation = useRunUpdate();
  const [showConfirm, setShowConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const { addNotification } = useNotifications();

  useEffect(() => {
    if (updateInfo?.latestVersion) {
      const dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
      setDismissed(dismissedVersion === updateInfo.latestVersion);
    }
  }, [updateInfo]);

  // Connect to update status WebSocket
  useEffect(() => {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/update-status`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'status') {
          setUpdateStatus(message.payload);
        }
      } catch (err) {
        console.error('Error parsing update status message:', err);
      }
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_VERSION_KEY, updateInfo.latestVersion);
    setDismissed(true);
  };

  const handleUpdate = async () => {
    try {
      const result = await runUpdateMutation.mutateAsync();
      if (result.success) {
        addNotification('success', 'Update started. The server will restart shortly...');
        setShowConfirm(false);
      }
    } catch (error) {
      addNotification('error', 'Failed to start update: ' + (error.response?.data?.error || error.message));
      setShowConfirm(false);
    }
  };

  if (!updateInfo?.hasUpdate || dismissed) {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 bg-blue-50 border border-blue-200 rounded-lg shadow-lg p-4 max-w-sm z-50">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-blue-400 hover:text-blue-600 transition-colors"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900">Update Available</h3>
            <p className="text-sm text-blue-700 mt-1">
              {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </p>

            {/* Update Status from WebSocket */}
            {updateStatus && updateStatus.isRunning && (
              <div className="mt-2 p-2 bg-blue-100 rounded border border-blue-300">
                <div className="flex items-center gap-2 mb-1">
                  <div className="animate-pulse w-2 h-2 bg-blue-600 rounded-full"></div>
                  <p className="text-xs font-medium text-blue-800">Update in progress...</p>
                </div>
                <p className="text-xs text-blue-700">
                  Step {updateStatus.steps.filter(s => s.status === 'completed').length + (updateStatus.steps.findIndex(s => s.status === 'running') >= 0 ? 1 : 0)}/{updateStatus.steps.length}
                </p>
              </div>
            )}

            {updateInfo.releaseNotes && (
              <details className="mt-2 text-xs text-blue-600">
                <summary className="cursor-pointer hover:text-blue-700">Release notes</summary>
                <div className="mt-2 p-2 bg-white rounded border border-blue-100 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{updateInfo.releaseNotes}</div>
              </details>
            )}
          </div>
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={runUpdateMutation.isPending}
              className="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded transition-colors"
            >
              {runUpdateMutation.isPending ? 'Updating...' : 'Update Now'}
            </button>
          ) : (
            <Confirm
              message="Are you sure you want to update? The server will restart automatically."
              onCancel={() => setShowConfirm(false)}
              onConfirm={handleUpdate}
              isLoading={runUpdateMutation.isPending}
            />
          )}
        </div>
      </div>
    </>
  );
}
