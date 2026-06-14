/** @format */

'use client';

import { useState } from 'react';
import { FiTrash2, FiRefreshCw, FiHardDrive } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useGetCacheStats, useClearCache } from '@/lib/api/cache';
import CacheGenerationClient from './CacheGenerationClient';
import { useTranslation } from '@/components/LanguageProvider';

export default function CachePage() {
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const { data: cacheData, isLoading: loading, refetch } = useGetCacheStats();
  const clearCacheMutation = useClearCache();
  const [confirmClear, setConfirmClear] = useState(null);

  const caches = cacheData?.caches || [];
  const totalSize = cacheData?.totalSizeFormatted || '0 B';
  const clearing = clearCacheMutation.isPending ? confirmClear : null;

  // Handle clear cache
  const handleClear = async (type) => {
    try {
      const response = await clearCacheMutation.mutateAsync(type);
      addNotification('success', t('admin.cache.cleared', { count: response.filesDeleted, size: response.freedSpaceFormatted }));
    } catch (error) {
      addNotification('error', error.response?.data?.error || error.message);
    } finally {
      setConfirmClear(null);
      refetch();
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('admin.cache.title')}</h1>
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </button>
      </div>

      {/* Total Size Card */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
        <div className="flex items-center gap-3">
          <FiHardDrive className="text-blue-400" size={24} />
          <div>
            <p className="text-gray-400 text-sm">{t('admin.cache.totalSize')}</p>
            <p className="text-2xl font-bold text-white">{totalSize}</p>
          </div>
          <button
            onClick={() => setConfirmClear('all')}
            disabled={clearing !== null}
            className="ml-auto px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            <FiTrash2 />
            <span className="hidden sm:inline">{t('admin.cache.clearAll')}</span>
          </button>
        </div>
      </div>

      {/* Cache Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {loading ? (
          <div className="col-span-full flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          caches.map((cache) => (
            <div key={cache.type} className="bg-gray-800 rounded-lg shadow p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-white">{cache.name}</h3>
                  <p className="text-xs text-gray-500">{cache.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <div>
                  <p className="text-lg font-bold text-white">{cache.sizeFormatted}</p>
                  <p className="text-xs text-gray-400">{t('admin.cache.nFiles', { count: cache.fileCount.toLocaleString() })}</p>
                </div>
                <button
                  onClick={() => setConfirmClear(cache.type)}
                  disabled={clearing !== null || cache.fileCount === 0}
                  className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 disabled:opacity-50 flex items-center gap-1"
                >
                  {clearing === cache.type ? (
                    <FiRefreshCw className="animate-spin" size={14} />
                  ) : (
                    <FiTrash2 size={14} />
                  )}
                  <span>{t('admin.cache.clear')}</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Generate Section */}
      <CacheGenerationClient />

      {/* Confirm Clear Modal */}
      {confirmClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              {t('admin.cache.clearTitle', { name: confirmClear === 'all' ? t('admin.cache.clearAllCaches') : caches.find((c) => c.type === confirmClear)?.name })}
            </h3>
            <p className="text-gray-400 mb-4">
              {t('admin.cache.clearWarning')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmClear(null)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleClear(confirmClear)}
                disabled={clearing !== null}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearing && <FiRefreshCw className="animate-spin" />}
                {t('admin.cache.clear')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
