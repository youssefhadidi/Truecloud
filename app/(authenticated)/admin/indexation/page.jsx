/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { FiTrash2, FiRefreshCw, FiDatabase, FiActivity } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useFileIndexing } from '@/hooks/useFileIndexing';
import { useFileIndexStats, useRebuildFileIndex, useClearFileIndex } from '@/lib/api/fileIndex';
import { useTranslation } from '@/components/LanguageProvider';

export default function IndexationPage() {
  const { t } = useTranslation();
  const [indexRebuilding, setIndexRebuilding] = useState(false);
  const [confirmIndexClear, setConfirmIndexClear] = useState(false);

  const { addNotification } = useNotifications();
  const indexStatus = useFileIndexing();

  const { data: indexStats, isLoading: indexLoading, refetch } = useFileIndexStats();
  const rebuildMutation = useRebuildFileIndex();
  const clearMutation = useClearFileIndex();

  const handleRebuildIndex = () => {
    setIndexRebuilding(true);
    rebuildMutation.mutate(undefined, {
      onSuccess: () => addNotification('success', t('adminIndexation.rebuildStarted')),
      onError: (error) => {
        addNotification('error', error.response?.data?.error || error.message);
        setIndexRebuilding(false);
      },
    });
  };

  const handleClearIndex = () => {
    clearMutation.mutate(undefined, {
      onSuccess: (data) => {
        addNotification('success', t('adminIndexation.clearedN', { count: data.deletedCount }));
        setConfirmIndexClear(false);
      },
      onError: (error) => {
        addNotification('error', error.response?.data?.error || error.message);
      },
    });
  };

  const handledDoneRef = useRef(false);

  useEffect(() => {
    if (indexStatus.done && !handledDoneRef.current) {
      handledDoneRef.current = true;
      setIndexRebuilding(false);
      if (indexStatus.error) {
        addNotification('error', t('adminIndexation.rebuildFailed', { error: indexStatus.error }));
      } else {
        addNotification('success', t('adminIndexation.rebuiltWithN', { count: indexStatus.total }));
      }
    } else if (!indexStatus.done) {
      handledDoneRef.current = false;
    }
  }, [indexStatus.done, indexStatus.error, indexStatus.total, addNotification, t]);

  return (
    <>
      <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
          <FiDatabase className="text-blue-400" />
          {t('adminIndexation.title')}
        </h1>
        <button
          onClick={() => refetch()}
          disabled={indexLoading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={indexLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('adminIndexation.refresh')}</span>
        </button>
      </div>

      {/* Index Stats Card */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
        {indexLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : indexStats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-sm">{t('adminIndexation.filesIndexed')}</p>
                <p className="text-2xl font-bold text-white">{indexStats.totalFiles.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">{t('adminIndexation.dirsIndexed')}</p>
                <p className="text-2xl font-bold text-white">{indexStats.totalDirs.toLocaleString()}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <FiActivity className={`${indexStats.watcherActive ? 'text-green-400' : 'text-red-400'}`} />
                <span className="text-sm text-gray-400">
                  {t('adminIndexation.watcher')} <span className="font-semibold">{indexStats.watcherActive ? t('adminIndexation.active') : t('adminIndexation.inactive')}</span>
                </span>
              </div>
              {indexStats.lastIndexed && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('adminIndexation.lastIndexed', { date: new Date(indexStats.lastIndexed).toLocaleString() })}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-gray-400">{t('adminIndexation.loadStatsFailed')}</p>
        )}
      </div>

      {/* Index Progress (during rebuild) */}
      {indexRebuilding && (
        <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
          <p className="text-white text-sm font-medium mb-3">{t('adminIndexation.rebuilding')}</p>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{
                width:
                  indexStatus.total > 0
                    ? `${(indexStatus.processed / indexStatus.total) * 100}%`
                    : '0%',
              }}
            ></div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {t('adminIndexation.itemsProgress', { processed: indexStatus.processed.toLocaleString(), total: indexStatus.total.toLocaleString() })}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleRebuildIndex}
          disabled={indexRebuilding || indexLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {indexRebuilding ? <FiRefreshCw className="animate-spin" /> : <FiRefreshCw />}
          {indexRebuilding ? t('adminIndexation.rebuildingShort') : t('adminIndexation.rebuildIndex')}
        </button>

        <button
          onClick={() => setConfirmIndexClear(true)}
          disabled={indexRebuilding || indexLoading}
          className="flex items-center gap-2 px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiTrash2 />
          {t('adminIndexation.clearIndex')}
        </button>
      </div>

      {/* Confirm Clear Index Modal */}
      {confirmIndexClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-2">{t('adminIndexation.clearTitle')}</h3>
            <p className="text-gray-400 mb-4">
              {t('adminIndexation.clearWarning')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmIndexClear(false)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
              >
                {t('adminIndexation.cancel')}
              </button>
              <button
                onClick={handleClearIndex}
                disabled={clearMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearMutation.isPending ? <FiRefreshCw className="animate-spin" /> : <FiTrash2 />}
                {t('adminIndexation.clearIndex')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
