/** @format */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranscodingSettings, useSaveTranscodingSettings } from '@/lib/api/system';

const RESOLUTION_OPTIONS = [
  { value: 'null', label: 'Original (no limit)', description: 'Preserve source resolution' },
  { value: '2160', label: '2160p (4K)', description: 'Cap at 3840×2160' },
  { value: '1440', label: '1440p (2K)', description: 'Cap at 2560×1440' },
  { value: '1080', label: '1080p (Full HD)', description: 'Cap at 1920×1080' },
  { value: '720', label: '720p (HD)', description: 'Cap at 1280×720' },
  { value: '480', label: '480p (SD)', description: 'Cap at 854×480' },
];

export default function TranscodingSettingsPage() {
  const { addNotification } = useNotifications();
  const { data, isLoading, refetch } = useTranscodingSettings();
  const saveMutation = useSaveTranscodingSettings();

  const [maxHeight, setMaxHeight] = useState('null');

  useEffect(() => {
    if (data?.config) {
      setMaxHeight(data.config.maxHeight === null ? 'null' : String(data.config.maxHeight));
    }
  }, [data?.config]);

  const handleSave = () => {
    const value = maxHeight === 'null' ? null : parseInt(maxHeight, 10);
    saveMutation.mutate(
      { maxHeight: value },
      {
        onSuccess: () => {
          addNotification('success', 'Transcoding settings saved');
        },
        onError: () => {
          addNotification('error', 'Failed to save transcoding settings');
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Transcoding Settings</h1>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={isLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Maximum output resolution
            </label>
            <select
              value={maxHeight}
              onChange={(e) => setMaxHeight(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Videos smaller than the selected resolution are not upscaled.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiSave />
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
            <p className="text-xs text-gray-400">
              Changes apply to new transcodes only. Clear the HLS cache in{' '}
              <Link href="/admin/cache" className="text-blue-400 hover:text-blue-300">
                Cache Management
              </Link>{' '}
              to re-transcode existing videos.
            </p>
          </div>

          {data?.path && (
            <div className="text-xs text-gray-500">
              Stored at: <span className="text-gray-400">{data.path}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
