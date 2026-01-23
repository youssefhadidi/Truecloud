/** @format */

'use client';

import { useRouter } from 'next/navigation';
import { FiArrowLeft, FiRefreshCw, FiPause, FiPlay, FiTrash2 } from 'react-icons/fi';
import TorrentDownloadComponent from '@/components/files/TorrentDownloadComponent';
import { useTorrentDownloads, usePauseDownload, useResumeDownload, useRemoveDownload } from '@/lib/api/downloads';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function DownloadsPage() {
  const router = useRouter();
  const { data: downloads = [], isLoading, refetch } = useTorrentDownloads();
  const { addNotification } = useNotifications();
  const pauseDownloadMutation = usePauseDownload();
  const resumeDownloadMutation = useResumeDownload();
  const removeDownloadMutation = useRemoveDownload();

  const handleDownloadStart = (downloadInfo) => {
    addNotification('success', `Download started: ${downloadInfo.name}`);
    refetch();
  };

  const handlePause = async (download) => {
    try {
      await pauseDownloadMutation.mutateAsync(download.gid);
      addNotification('success', `Paused: ${download.name}`);
    } catch (error) {
      addNotification('error', `Failed to pause: ${error.message}`);
    }
  };

  const handleResume = async (download) => {
    try {
      await resumeDownloadMutation.mutateAsync(download.gid);
      addNotification('success', `Resumed: ${download.name}`);
    } catch (error) {
      addNotification('error', `Failed to resume: ${error.message}`);
    }
  };

  const handleRemove = async (download) => {
    try {
      await removeDownloadMutation.mutateAsync(download.gid);
      addNotification('success', `Removed: ${download.name}`);
    } catch (error) {
      addNotification('error', `Failed to remove: ${error.message}`);
    }
  };

  return (
    <div className="w-full h-full bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden">
      {/* Page Header */}
      <div className="bg-white dark:bg-gray-800 shadow flex-shrink-0">
        <div className="mx-auto px-4 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
              <FiArrowLeft size={24} className="text-gray-700 dark:text-gray-300" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Downloads</h1>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Download Form */}
            <div className="lg:col-span-1">
              <TorrentDownloadComponent onDownloadStart={handleDownloadStart} />
            </div>

            {/* Downloads List */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-6">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Active Downloads</h2>
                  <button onClick={() => refetch()} disabled={isLoading} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
                    <FiRefreshCw size={20} className={`text-gray-700 dark:text-gray-300 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  </div>
                ) : downloads.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                    <p>No active downloads</p>
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
                            {download.status}
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
                            <p className="text-xs text-gray-500 dark:text-gray-500">Progress</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.progress}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{download.isTorrent ? 'Download' : 'Speed'}</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.downloadSpeed}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Downloaded</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.downloaded}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Total Size</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.totalSize}</p>
                          </div>
                        </div>

                        {/* Torrent-specific info */}
                        {download.isTorrent && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">Upload Speed</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.uploadSpeed}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">Peers</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.peers}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-500">Seeders</p>
                              <p className="font-medium text-gray-900 dark:text-white">{download.seeders}</p>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        {download.error && (
                          <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-xs">
                            Error: {download.error}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {download.status === 'active' && (
                            <button
                              onClick={() => handlePause(download)}
                              disabled={pauseDownloadMutation.isPending}
                              className="flex items-center gap-1 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50 disabled:opacity-50 text-sm"
                            >
                              <FiPause size={14} />
                              Pause
                            </button>
                          )}
                          {download.status === 'paused' && (
                            <button
                              onClick={() => handleResume(download)}
                              disabled={resumeDownloadMutation.isPending}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 text-sm"
                            >
                              <FiPlay size={14} />
                              Resume
                            </button>
                          )}
                          {(download.status === 'complete' || download.status === 'error' || download.status === 'removed') && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {download.status === 'complete' ? 'Download completed' : download.status === 'error' ? 'Download failed' : 'Download removed'}
                            </span>
                          )}
                          <button
                            onClick={() => handleRemove(download)}
                            disabled={removeDownloadMutation.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 text-sm ml-auto"
                          >
                            <FiTrash2 size={14} />
                            Remove
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
      </main>
    </div>
  );
}
