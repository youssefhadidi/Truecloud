/** @format */

'use client';

import { useMemo } from 'react';
import DownloadCard from './DownloadCard';

/**
 * DownloadsList - Displays all active downloads using DownloadCard components.
 *
 * Separates downloads from files for cleaner rendering and independent
 * real-time updates per download.
 */
export default function DownloadsList({
  files,
  onPauseDownload,
  onResumeDownload,
  onRemoveDownload,
}) {
  // Extract only download items from the files array
  const downloads = useMemo(() => {
    return files.filter((f) => f.isDownloading);
  }, [files]);

  if (downloads.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 bg-gray-800 rounded-lg shadow border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-750 border-b border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">Active Downloads ({downloads.length})</h3>
      </div>

      {/* Download Cards */}
      <div className="divide-y divide-gray-700">
        {downloads.map((download) => (
          <DownloadCard
            key={download.downloadGid}
            gid={download.downloadGid}
            initialData={{
              name: download.name,
              path: download.id?.replace('dl-', '') || '',
              progress: download.downloadProgress || 0,
              status: download.downloadStatus || 'active',
              downloadSpeed: download.downloadSpeed || '0 B/s',
              uploadSpeed: download.uploadSpeed || '0 B/s',
              seeders: download.seeders || 0,
              peers: download.peers || 0,
              isTorrent: download.isTorrent || false,
              error: download.error || null,
            }}
            onPause={onPauseDownload}
            onResume={onResumeDownload}
            onRemove={onRemoveDownload}
          />
        ))}
      </div>
    </div>
  );
}
