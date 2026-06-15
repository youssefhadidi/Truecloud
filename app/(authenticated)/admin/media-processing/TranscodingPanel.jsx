/** @format */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranscodingSettings, useSaveTranscodingSettings } from '@/lib/api/system';
import { useTranslation } from '@/components/LanguageProvider';

export default function TranscodingPanel() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();

  const RESOLUTION_OPTIONS = [
    { value: 'null', label: t('adminMedia.resOriginal'), description: t('adminMedia.resOriginalDesc') },
    { value: '2160', label: '2160p (4K)', description: t('adminMedia.res2160Desc') },
    { value: '1440', label: '1440p (2K)', description: t('adminMedia.res1440Desc') },
    { value: '1080', label: '1080p (Full HD)', description: t('adminMedia.res1080Desc') },
    { value: '720', label: '720p (HD)', description: t('adminMedia.res720Desc') },
    { value: '480', label: '480p (SD)', description: t('adminMedia.res480Desc') },
  ];
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
        onSuccess: () => addNotification('success', t('adminMedia.transcodingSaved')),
        onError: () => addNotification('error', t('adminMedia.transcodingSaveFailed')),
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
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminMedia.maxResolution')}</label>
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
            <p className="text-xs text-gray-400 mt-1">{t('adminMedia.noUpscaleHint')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FiSave />
              {saveMutation.isPending ? t('adminMedia.saving') : t('adminMedia.saveSettings')}
            </button>
            <p className="text-xs text-gray-400">
              {t('adminMedia.transcodingNotePrefix')}
              <Link href="/admin/cache" className="text-blue-400 hover:text-blue-300">
                {t('adminMedia.cacheManagement')}
              </Link>
              {t('adminMedia.transcodingNoteSuffix')}
            </p>
          </div>

          {data?.path && (
            <div className="text-xs text-gray-500">
              {t('adminMedia.storedAt').split('{path}').flatMap((part, i) =>
                i === 0 ? [part] : [<span key={i} className="text-gray-400">{data.path}</span>, part],
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
