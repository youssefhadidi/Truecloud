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
        const { payload } = message;

        // Only process messages for this download's gid
        if (payload.gid !== gid) return;

        if (payload.type === 'download-progress') {
          setDownload((prev) => ({
            ...prev,
            progress: payload.progress ?? prev.progress,
            downloadSpeed: payload.downloadSpeed || prev.downloadSpeed,
            uploadSpeed: payload.uploadSpeed || prev.uploadSpeed,
            seeders: payload.seeders ?? prev.seeders,
            peers: payload.peers ?? prev.peers,
          }));
        } else if (payload.type === 'download-paused') {
          setDownload((prev) => ({
            ...prev,
            status: 'paused',
          }));
        } else if (payload.type === 'download-resumed') {
          setDownload((prev) => ({
            ...prev,
            status: 'active',
          }));
        } else if (payload.type === 'download-removed') {
          setDownload((prev) => ({
            ...prev,
            status: 'removed',
          }));
        } else if (payload.type === 'download-complete') {
          setDownload((prev) => ({
            ...prev,
            status: 'complete',
          }));
        } else if (payload.type === 'download-added' && payload.gid === gid) {
          setDownload((prev) => ({
            ...prev,
            name: payload.name || prev.name,
            path: payload.path || prev.path,
            progress: payload.progress ?? prev.progress,
            status: payload.status || prev.status,
            downloadSpeed: payload.downloadSpeed || prev.downloadSpeed,
            uploadSpeed: payload.uploadSpeed || prev.uploadSpeed,
            seeders: payload.seeders ?? prev.seeders,
            peers: payload.peers ?? prev.peers,
            isTorrent: payload.isTorrent ?? prev.isTorrent,
            error: payload.error || null,
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
