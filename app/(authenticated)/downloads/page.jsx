/** @format */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import TorrentDownloadComponent from '@/components/files/TorrentDownloadComponent';
import Notifications from '@/components/Notifications';

export default function DownloadsPage() {
  const router = useRouter();
  const [downloads, setDownloads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  // Fetch downloads
  useEffect(() => {
    fetchDownloads();
  }, []);

  const fetchDownloads = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/files/torrent-download');
      if (!response.ok) throw new Error('Failed to fetch downloads');
      const data = await response.json();
      setDownloads(data.downloads || []);
    } catch (error) {
      addNotification('error', error.message || 'Failed to fetch downloads');
    } finally {
      setIsLoading(false);
    }
  };

  const addNotification = (type, message, title = null) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [
      ...prev,
      {
        id,
        type,
        message,
        title,
        autoDismiss: true,
        duration: 5000,
      },
    ]);
  };

  const dismissNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleDownloadStart = (downloadInfo) => {
    addNotification('success', `Download started: ${downloadInfo.name}`);
    fetchDownloads();
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
                  <button onClick={fetchDownloads} disabled={isLoading} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
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
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-gray-600 dark:text-gray-400">
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Progress</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.progress}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Speed</p>
                            <p className="font-medium text-gray-900 dark:text-white">{download.speed}</p>
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <Notifications notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}
