/** @format */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';

const SIZE_MIN = 64;
const SIZE_MAX = 1024;
const QUALITY_MIN = 30;
const QUALITY_MAX = 100;

export default function ThumbnailSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [configPath, setConfigPath] = useState('');
  const [form, setForm] = useState({ size: 200, quality: 75 });
  const { addNotification } = useNotifications();

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/thumbnail-settings');
      if (!response.ok) throw new Error('Failed to load thumbnail settings');
      const data = await response.json();
      setForm({
        size: data?.config?.size ?? 200,
        quality: data?.config?.quality ?? 75,
      });
      setConfigPath(data?.path || '');
    } catch (error) {
      addNotification('error', error.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
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

    try {
      setSaving(true);
      const response = await fetch('/api/admin/thumbnail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, quality }),
      });

      if (!response.ok) throw new Error('Failed to save thumbnail settings');
      const data = await response.json();
      setForm({
        size: data?.config?.size ?? size,
        quality: data?.config?.quality ?? quality,
      });
      setConfigPath(data?.path || configPath);
      addNotification('success', 'Thumbnail settings saved');
    } catch (error) {
      addNotification('error', error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setResetting(true);
      const response = await fetch('/api/admin/thumbnail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) throw new Error('Failed to reset thumbnail settings');
      const data = await response.json();
      setForm({
        size: data?.config?.size ?? 200,
        quality: data?.config?.quality ?? 75,
      });
      setConfigPath(data?.path || configPath);
      addNotification('success', 'Thumbnail settings reset to defaults');
    } catch (error) {
      addNotification('error', error.message || 'Failed to reset settings');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
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
        <button
          onClick={fetchSettings}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
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
            <p className="text-xs text-gray-400 mt-1">Range: {SIZE_MIN}-{SIZE_MAX}. Applies to image, video, and PDF thumbnails.</p>
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
            <p className="text-xs text-gray-400 mt-1">Range: {QUALITY_MIN}-{QUALITY_MAX}. Higher values increase file size.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiSave />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleReset}
              disabled={saving || resetting}
              className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50"
            >
              {resetting ? 'Resetting...' : 'Reset to Defaults'}
            </button>
            <p className="text-xs text-gray-400">
              Changes affect new thumbnails only. Clear cache in <Link href="/admin/cache" className="text-blue-400 hover:text-blue-300">Cache Management</Link> to regenerate.
            </p>
          </div>

          {configPath && (
            <div className="text-xs text-gray-500">
              Stored at: <span className="text-gray-400">{configPath}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
