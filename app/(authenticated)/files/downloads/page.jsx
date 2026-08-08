/** @format */

'use client';

import { useState } from 'react';
import { FiPause, FiPlay, FiTrash2 } from 'react-icons/fi';
import TorrentDownloadComponent from '@/components/files/TorrentDownloadComponent';
import TorrentSearchPanel from '@/components/files/TorrentSearchPanel';
import { useActiveDownloads } from '@/hooks/useActiveDownloads';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

/**
 * Downloads management page.
 *
 * Uses the same useActiveDownloads WebSocket hook as the file browser,
 * so all download status updates are real-time (no polling needed).
 */
export default function DownloadsPage() {
  const { downloads: downloadsMap, pauseDownload, resumeDownload, removeDownload } = useActiveDownloads();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState(null); // gid of item currently being acted on

  // Convert downloads map to array (show ALL downloads, not filtered by path)
  const downloads = Object.values(downloadsMap);

  const handleDownloadStart = (downloadInfo) => {
    addNotification('success', t('notify.downloadStarted', { name: downloadInfo.name }));
  };

  const handlePause = async (download) => {
    try {
      setActionLoading(download.gid);
      await pauseDownload(download.gid);
      addNotification('success', t('notify.paused', { name: download.name }));
    } catch (error) {
      addNotification('error', t('notify.pauseFailed', { message: error.message }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async (download) => {
    try {
      setActionLoading(download.gid);
      await resumeDownload(download.gid);
      addNotification('success', t('notify.resumed', { name: download.name }));
    } catch (error) {
      addNotification('error', t('notify.resumeFailed', { message: error.message }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (download) => {
    try {
      setActionLoading(download.gid);
      await removeDownload(download.gid);
      addNotification('success', t('notify.removed', { name: download.name }));
    } catch (error) {
      addNotification('error', t('notify.removeFailed', { message: error.message }));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Page Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('downloads.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('downloads.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 dark:text-white">{downloads.length}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Torrent Index Search — full width, results table needs the room */}
            <div className="lg:col-span-3">
              <TorrentSearchPanel onDownloadStart={handleDownloadStart} />
            </div>

            {/* Download Form */}
            <div className="lg:col-span-1">
              <TorrentDownloadComponent onDownloadStart={handleDownloadStart} />
            </div>

            {/* Downloads List */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('downloads.activeDownloads')}</h2>
                </div>

                {downloads.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                    <p>{t('downloads.noActiveDownloads')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {downloads.map((download) => (
                      <div key={download.gid} className="p-6">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <h3 className="font-medium text-gray-900 dark:text-white truncate">{download.name}</h3>
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                              download.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : download.status === 'paused'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}
                          >
                            {t(`downloads.status.${download.status}`)}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-2">
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${download.progress}%` }} />
                          </div>
                        </div>

                        {/* Download Info */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.progress')}</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.progress}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{download.isTorrent ? t('common.download') : t('downloads.speed')}</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.downloadSpeed}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.downloaded')}</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.downloaded}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.totalSize')}</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.totalSize}</p>
                          </div>
                        </div>

                        {/* Torrent-specific info */}
                        {download.isTorrent && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.uploadSpeed')}</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.uploadSpeed}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.peers')}</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.peers}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">{t('downloads.seeders')}</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.seeders}</p>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        {download.error && (
                          <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-xs">
                            {t('common.error')}: {download.error}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {download.status === 'active' && (
                            <button
                              onClick={() => handlePause(download)}
                              disabled={actionLoading === download.gid}
                              className="flex items-center gap-1 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50 disabled:opacity-50 text-sm"
                            >
                              <FiPause size={14} />
                              {t('downloads.pause')}
                            </button>
                          )}
                          {download.status === 'paused' && (
                            <button
                              onClick={() => handleResume(download)}
                              disabled={actionLoading === download.gid}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 text-sm"
                            >
                              <FiPlay size={14} />
                              {t('downloads.resume')}
                            </button>
                          )}
                          {(download.status === 'complete' || download.status === 'error' || download.status === 'removed') && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {download.status === 'complete' ? t('downloads.completed') : download.status === 'error' ? t('downloads.failed') : t('downloads.removedLabel')}
                            </span>
                          )}
                          <button
                            onClick={() => handleRemove(download)}
                            disabled={actionLoading === download.gid}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 text-sm ml-auto"
                          >
                            <FiTrash2 size={14} />
                            {t('common.remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
