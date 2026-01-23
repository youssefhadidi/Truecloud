/** @format */

'use client';

import { useState } from 'react';
import { FiCheck, FiX, FiDownload } from 'react-icons/fi';
import Confirm from '@/components/Confirm';
import { useSystemRequirements, useInstallRequirement } from '@/lib/api/system';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function SystemRequirementsCheck() {
  const { data: requirements, isLoading, refetch } = useSystemRequirements();
  const installMutation = useInstallRequirement();
  const [installing, setInstalling] = useState(null);
  const [showConfirm, setShowConfirm] = useState(null);
  const { addNotification } = useNotifications();

  const handleInstall = async (name) => {
    setShowConfirm(name);
  };

  const handleConfirmInstall = async () => {
    if (!showConfirm) return;
    try {
      setInstalling(showConfirm);
      const result = await installMutation.mutateAsync(showConfirm);
      addNotification('success', result.message || `${showConfirm} installation started`);
      // Recheck requirements after a delay
      setTimeout(refetch, 2000);
    } catch (error) {
      addNotification('error', error.response?.data?.message || error.message || `Failed to install ${showConfirm}`);
    } finally {
      setInstalling(null);
      setShowConfirm(null);
    }
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
    <div className="bg-gray-800 rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white mb-2">System Requirements</h2>
        <p className="text-sm text-gray-400">
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
              className={`flex items-center justify-between p-4 rounded-lg border ${req.installed ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}
            >
              <div className="flex items-center gap-3">
                {req.installed ? <FiCheck className="text-green-400" size={20} /> : <FiX className="text-red-400" size={20} />}
                <div>
                  <p className={`font-medium ${req.installed ? 'text-green-300' : 'text-red-300'}`}>{req.name}</p>
                  {req.version && <p className={`text-sm ${req.installed ? 'text-green-400' : 'text-red-400'}`}>{req.version}</p>}
                  {req.description && <p className={`text-xs mt-1 ${req.installed ? 'text-green-500' : 'text-red-500'}`}>{req.description}</p>}
                </div>
              </div>

              {!req.installed && req.installable && (
                <div>
                  {showConfirm !== req.name ? (
                    <button
                      onClick={() => handleInstall(req.name)}
                      disabled={installing === req.name}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                        installing === req.name ? 'bg-gray-600 text-gray-300 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      <FiDownload size={16} />
                      {installing === req.name ? 'Installing...' : 'Install'}
                    </button>
                  ) : (
                    <Confirm message={`Install ${req.name}?`} onCancel={() => setShowConfirm(null)} onConfirm={handleConfirmInstall} isLoading={installing === req.name} />
                  )}
                </div>
              )}

              {!req.installed && !req.installable && <p className="text-sm text-red-400 font-medium">Cannot auto-install</p>}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => refetch()} className="mt-4 w-full px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 font-medium">
        Refresh
      </button>
    </div>
  );
}
