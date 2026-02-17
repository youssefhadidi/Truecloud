/** @format */

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useThumbnailSettings, useSaveThumbnailSettings } from '@/lib/api/system';

const SIZE_MIN = 64;
const SIZE_MAX = 1024;
const QUALITY_MIN = 30;
const QUALITY_MAX = 100;

export default function ThumbnailSettingsPage() {
  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: settingsData, isLoading, refetch } = useThumbnailSettings();
  const saveMutation = useSaveThumbnailSettings();

  // Local UI state
  const [form, setForm] = useState({ size: 200, quality: 75 });

  // Update form when settings data loads
  useEffect(() => {
    if (settingsData?.config) {
      setForm({
        size: settingsData.config.size ?? 200,
        quality: settingsData.config.quality ?? 75,
      });
    }
  }, [settingsData?.config]);

  const handleSave = () => {
    const size = parseInt(form.size, 10);
    const quality = parseInt(form.quality, 10);

    if (Number.isNaN(size) || size < SIZE_MIN || size > SIZE_MAX) {
      addNotification('error', `Size must be between ${SIZE_MIN} and ${SIZE_MAX}`);
      return;
    }

    if (Number.isNaN(quality) || quality < QUALITY_MIN || quality > QUALITY_MAX) {
      addNotification('error', `Quality must be between ${QUALITY_MIN} and ${QUALITY_MAX}`);
      return;
    }

    saveMutation.mutate(
      { size, quality },
      {
        onSuccess: () => {
          addNotification('success', 'Thumbnail settings saved');
        },
        onError: (error) => {
          addNotification('error', error.message || 'Failed to save settings');
        },
      }
    );
  };

  const handleReset = () => {
    saveMutation.mutate(
      {},
      {
        onSuccess: () => {
          addNotification('success', 'Thumbnail settings reset to defaults');
        },
        onError: (error) => {
          addNotification('error', error.message || 'Failed to reset settings');
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
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Thumbnail Settings</h1>
        <button onClick={() => refetch()} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50">
          <FiRefreshCw className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Thumbnail size (px)</label>
            <input
              type="number"
              min={SIZE_MIN}
              max={SIZE_MAX}
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
            />
            <p className="text-xs text-gray-400 mt-1">
              Range: {SIZE_MIN}-{SIZE_MAX}. Applies to image, video, and PDF thumbnails.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Thumbnail quality</label>
            <input
              type="number"
              min={QUALITY_MIN}
              max={QUALITY_MAX}
              value={form.quality}
              onChange={(e) => setForm({ ...form, quality: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
            />
            <p className="text-xs text-gray-400 mt-1">
              Range: {QUALITY_MIN}-{QUALITY_MAX}. Higher values increase file size.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              <FiSave />
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
            <button onClick={handleReset} disabled={saveMutation.isPending} className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50">
              {saveMutation.isPending ? 'Resetting...' : 'Reset to Defaults'}
            </button>
            <p className="text-xs text-gray-400">
              Changes affect new thumbnails only. Clear cache in{' '}
              <Link href="/admin/cache" className="text-blue-400 hover:text-blue-300">
                Cache Management
              </Link>{' '}
              to regenerate.
            </p>
          </div>

          {settingsData?.path && (
            <div className="text-xs text-gray-500">
              Stored at: <span className="text-gray-400">{settingsData.path}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
