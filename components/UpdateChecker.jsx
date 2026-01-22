'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

export default function UpdateChecker() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateStarted, setUpdateStarted] = useState(false);

  // Check for updates every 1 hour
  const { data: updateInfo, isLoading } = useQuery({
    queryKey: ['checkUpdates'],
    queryFn: async () => {
      try {
        const response = await axios.get('/api/system/check-updates');
        return response.data;
      } catch (error) {
        console.error('Failed to check for updates:', error);
        return null;
      }
    },
    refetchInterval: 60 * 60 * 1000, // 1 hour
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const handleUpdate = async () => {
    if (!window.confirm('Are you sure you want to update? The server will restart automatically.')) {
      return;
    }

    setIsUpdating(true);
    try {
      const response = await axios.post('/api/system/run-update');
      if (response.data.success) {
        setUpdateStarted(true);
        // Show message for 5 seconds then reset
        setTimeout(() => {
          setIsUpdating(false);
          setUpdateStarted(false);
        }, 5000);
      }
    } catch (error) {
      console.error('Failed to start update:', error);
      alert('Failed to start update: ' + (error.response?.data?.error || error.message));
      setIsUpdating(false);
    }
  };

  if (!updateInfo?.hasUpdate) {
    return null; // Don't show anything if no update available
  }

  return (
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
              <div className="mt-2 p-2 bg-white rounded border border-blue-100 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                {updateInfo.releaseNotes}
              </div>
            </details>
          )}
        </div>
        <button
          onClick={handleUpdate}
          disabled={isUpdating}
          className="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded transition-colors"
        >
          {isUpdating ? 'Updating...' : 'Update Now'}
        </button>
      </div>
      {updateStarted && (
        <p className="text-xs text-green-700 mt-2 font-medium">
          ✓ Update started. Server will restart shortly...
        </p>
      )}
    </div>
  );
}
