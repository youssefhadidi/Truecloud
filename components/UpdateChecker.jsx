/** @format */

'use client';

import { useState } from 'react';
import Notifications from '@/components/Notifications';
import Confirm from '@/components/Confirm';
import { useCheckUpdates, useRunUpdate } from '@/lib/api/system';

export default function UpdateChecker() {
  const { data: updateInfo, isLoading } = useCheckUpdates();
  const runUpdateMutation = useRunUpdate();
  const [notifications, setNotifications] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);

  const addNotification = (type, message, title = null) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, type, message, title }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
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

      {/* Notifications */}
      <Notifications notifications={notifications} />
    </>
  );
}
