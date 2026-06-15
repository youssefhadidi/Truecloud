/** @format */

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useThumbnailSettings, useSaveThumbnailSettings } from '@/lib/api/system';
import { useTranslation } from '@/components/LanguageProvider';

const SIZE_MIN = 64;
const SIZE_MAX = 1024;
const QUALITY_MIN = 30;
const QUALITY_MAX = 100;

export default function ThumbnailsPanel() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();

  const { data: settingsData, isLoading, refetch } = useThumbnailSettings();
  const saveMutation = useSaveThumbnailSettings();

  const [form, setForm] = useState({ size: 200, quality: 75 });

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
      addNotification('error', t('adminMedia.sizeRangeError', { min: SIZE_MIN, max: SIZE_MAX }));
      return;
    }

    if (Number.isNaN(quality) || quality < QUALITY_MIN || quality > QUALITY_MAX) {
      addNotification('error', t('adminMedia.qualityRangeError', { min: QUALITY_MIN, max: QUALITY_MAX }));
      return;
    }

    saveMutation.mutate(
      { size, quality },
      {
        onSuccess: () => addNotification('success', t('adminMedia.thumbnailSaved')),
        onError: (error) => addNotification('error', error.message || t('adminMedia.saveFailed')),
      }
    );
  };

  const handleReset = () => {
    saveMutation.mutate(
      {},
      {
        onSuccess: () => addNotification('success', t('adminMedia.thumbnailReset')),
        onError: (error) => addNotification('error', error.message || t('adminMedia.resetFailed')),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('adminMedia.loading')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex justify-end mb-3">
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={isLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('adminMedia.refresh')}</span>
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminMedia.thumbnailSize')}</label>
            <input
              type="number"
              min={SIZE_MIN}
              max={SIZE_MAX}
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
            />
            <p className="text-xs text-gray-400 mt-1">
              {t('adminMedia.thumbnailSizeHint', { min: SIZE_MIN, max: SIZE_MAX })}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminMedia.thumbnailQuality')}</label>
            <input
              type="number"
              min={QUALITY_MIN}
              max={QUALITY_MAX}
              value={form.quality}
              onChange={(e) => setForm({ ...form, quality: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
            />
            <p className="text-xs text-gray-400 mt-1">
              {t('adminMedia.thumbnailQualityHint', { min: QUALITY_MIN, max: QUALITY_MAX })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              <FiSave />
              {saveMutation.isPending ? t('adminMedia.saving') : t('adminMedia.saveSettings')}
            </button>
            <button onClick={handleReset} disabled={saveMutation.isPending} className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50">
              {saveMutation.isPending ? t('adminMedia.resetting') : t('adminMedia.resetToDefaults')}
            </button>
            <p className="text-xs text-gray-400">
              {t('adminMedia.thumbnailNotePrefix')}
              <Link href="/admin/cache" className="text-blue-400 hover:text-blue-300">
                {t('adminMedia.cacheManagement')}
              </Link>
              {t('adminMedia.thumbnailNoteSuffix')}
            </p>
          </div>

          {settingsData?.path && (
            <div className="text-xs text-gray-500">
              {t('adminMedia.storedAt').split('{path}').flatMap((part, i) =>
                i === 0 ? [part] : [<span key={i} className="text-gray-400">{settingsData.path}</span>, part],
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
