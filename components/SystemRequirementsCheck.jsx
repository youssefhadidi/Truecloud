/** @format */

'use client';

import { useState } from 'react';
import { FiCheck, FiX, FiDownload } from 'react-icons/fi';
import Notifications from '@/components/Notifications';
import { useSystemRequirements, useInstallRequirement } from '@/lib/api/system';

export default function SystemRequirementsCheck() {
  const { data: requirements, isLoading, refetch } = useSystemRequirements();
  const installMutation = useInstallRequirement();
  const [installing, setInstalling] = useState(null);
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

  const handleInstall = async (name) => {
    showConfirm(`Install ${name}?`, async () => {
      try {
        setInstalling(name);
        const result = await installMutation.mutateAsync(name);
        addNotification('success', result.message || `${name} installation started`);
        // Recheck requirements after a delay
        setTimeout(refetch, 2000);
      } catch (error) {
        addNotification('error', error.response?.data?.message || error.message || `Failed to install ${name}`);
      } finally {
        setInstalling(null);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const installedCount = requirements.filter((r) => r.installed).length;
  const totalCount = requirements.length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">System Requirements</h2>
        <p className="text-sm text-gray-600">
          {installedCount}/{totalCount} required programs installed
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-gray-500">No system requirements found</p>
      ) : (
        <div className="space-y-3">
          {requirements.map((req) => (
            <div
              key={req.name}
              className={`flex items-center justify-between p-4 rounded-lg border ${req.installed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
            >
              <div className="flex items-center gap-3">
                {req.installed ? <FiCheck className="text-green-600" size={20} /> : <FiX className="text-red-600" size={20} />}
                <div>
                  <p className={`font-medium ${req.installed ? 'text-green-900' : 'text-red-900'}`}>{req.name}</p>
                  {req.version && <p className={`text-sm ${req.installed ? 'text-green-700' : 'text-red-700'}`}>{req.version}</p>}
                  {req.description && <p className={`text-xs mt-1 ${req.installed ? 'text-green-600' : 'text-red-600'}`}>{req.description}</p>}
                </div>
              </div>

              {!req.installed && req.installable && (
                <button
                  onClick={() => handleInstall(req.name)}
                  disabled={installing === req.name}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    installing === req.name ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  <FiDownload size={16} />
                  {installing === req.name ? 'Installing...' : 'Install'}
                </button>
              )}

              {!req.installed && !req.installable && <p className="text-sm text-red-600 font-medium">Cannot auto-install</p>}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => refetch()} className="mt-4 w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
        Refresh
      </button>

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
    </div>
  );
}
