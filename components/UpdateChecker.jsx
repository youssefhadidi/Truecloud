/** @format */

'use client';

import { useState } from 'react';
import axios from 'axios';
import Notifications from '@/components/Notifications';
import { useCheckUpdates, useRunUpdate } from '@/lib/api/system';

export default function UpdateChecker() {
  const { data: updateInfo, isLoading } = useCheckUpdates();
  const runUpdateMutation = useRunUpdate();
  const [notifications, setNotifications] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const addNotification = (type, message, title = null) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, type, message, title }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  };

  const showConfirm = (message, onConfirm) => {
    setConfirmDialog({ message, onConfirm });
  };

  const handleUpdate = async () => {
    showConfirm('Are you sure you want to update? The server will restart automatically.', async () => {
      try {
        const result = await runUpdateMutation.mutateAsync();
        if (result.success) {
          addNotification('success', 'Update started. The server will restart shortly...');
        }
      } catch (error) {
        addNotification('error', 'Failed to start update: ' + (error.response?.data?.error || error.message));
      }
    });
  };

  if (!updateInfo?.hasUpdate) {
    return null; // Don't show anything if no update available
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 bg-blue-50 border border-blue-200 rounded-lg shadow-lg p-4 max-w-sm z-50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900">Update Available</h3>
            <p className="text-sm text-blue-700 mt-1">
              {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </p>
            {updateInfo.releaseNotes && (
              <details className="mt-2 text-xs text-blue-600">
                <summary className="cursor-pointer hover:text-blue-700">Release notes</summary>
                <div className="mt-2 p-2 bg-white rounded border border-blue-100 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{updateInfo.releaseNotes}</div>
              </details>
            )}
          </div>
          <button
            onClick={handleUpdate}
            disabled={runUpdateMutation.isPending}
            className="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded transition-colors"
          >
            {runUpdateMutation.isPending ? 'Updating...' : 'Update Now'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      <Notifications notifications={notifications} />

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full shadow-xl">
            <p className="text-gray-900 dark:text-white mb-6">{confirmDialog.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
