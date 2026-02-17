/** @format */

import { useState, useEffect } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Custom hook to subscribe to WebSocket updates for a specific download.
 * Each download maintains its own local state independent of the global state.
 */
export function useDownloadWebSocket(gid, initialData = {}) {
  const [download, setDownload] = useState({
    gid,
    name: initialData.name || 'Unknown',
    path: initialData.path || '',
    progress: initialData.progress || 0,
    status: initialData.status || 'active',
    downloadSpeed: initialData.downloadSpeed || '0 B/s',
    uploadSpeed: initialData.uploadSpeed || '0 B/s',
    seeders: initialData.seeders || 0,
    peers: initialData.peers || 0,
    isTorrent: initialData.isTorrent || false,
    error: initialData.error || null,
  });

  const { subscribe } = useWebSocket();

  // Subscribe to WebSocket updates for this specific download
  useEffect(() => {
    const unsubscribe = subscribe('torrent-downloads', (message) => {
      try {
        const { type, payload: downloadData } = message.payload;

        // Only process messages for this download's gid
        if (downloadData.gid !== gid) return;

        if (type === 'download-progress') {
          setDownload((prev) => ({
            ...prev,
            progress: downloadData.progress ?? prev.progress,
            downloadSpeed: downloadData.downloadSpeed || prev.downloadSpeed,
            uploadSpeed: downloadData.uploadSpeed || prev.uploadSpeed,
            seeders: downloadData.seeders ?? prev.seeders,
            peers: downloadData.peers ?? prev.peers,
          }));
        } else if (type === 'download-paused') {
          setDownload((prev) => ({
            ...prev,
            status: 'paused',
          }));
        } else if (type === 'download-resumed') {
          setDownload((prev) => ({
            ...prev,
            status: 'active',
          }));
        } else if (type === 'download-removed') {
          setDownload((prev) => ({
            ...prev,
            status: 'removed',
          }));
        } else if (type === 'download-complete') {
          setDownload((prev) => ({
            ...prev,
            status: 'complete',
          }));
        } else if (type === 'download-added' && downloadData.gid === gid) {
          setDownload((prev) => ({
            ...prev,
            name: downloadData.name || prev.name,
            path: downloadData.path || prev.path,
            progress: downloadData.progress ?? prev.progress,
            status: downloadData.status || prev.status,
            downloadSpeed: downloadData.downloadSpeed || prev.downloadSpeed,
            uploadSpeed: downloadData.uploadSpeed || prev.uploadSpeed,
            seeders: downloadData.seeders ?? prev.seeders,
            peers: downloadData.peers ?? prev.peers,
            isTorrent: downloadData.isTorrent ?? prev.isTorrent,
            error: downloadData.error || null,
          }));
        }
      } catch (err) {
        console.error('[DOWNLOAD WEBSOCKET] Error processing message:', err);
      }
    });

    return unsubscribe;
  }, [gid, subscribe]);

  return download;
}
