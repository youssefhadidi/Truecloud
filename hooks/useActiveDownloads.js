/**
 * Hook for real-time torrent download tracking via WebSocket.
 *
 * This is the primary download state management hook, used by both the
 * file browser (useFilesPage) and the downloads management page.
 *
 * DATA FLOW:
 * 1. On mount, connects to WebSocket at /api/ws/torrent-downloads
 * 2. On connect, fetches initial state via GET /api/files/torrent-download
 * 3. Receives real-time updates: progress (every 1s), status changes, completions
 * 4. Provides pause/resume/remove actions via PATCH /api/files/torrent-download
 *    (the backend broadcasts status changes back through WebSocket)
 *
 * The downloads are stored as a Map<gid, downloadInfo> where gid = torrent infoHash.
 * Each download's `path` field is a RELATIVE path (matching the file browser's
 * navigation.currentPath), used to filter which downloads appear in which directory.
 *
 * On download completion, a 'torrent-download-complete' custom event is dispatched
 * so the file browser can refresh and show the newly completed files.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import axios from 'axios';

export function useActiveDownloads() {
  const downloadsRef = useRef(new Map()); // Map<gid, downloadInfo>
  const [downloads, setDownloads] = useState({});
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Sync downloads map to state
  const syncDownloads = useCallback(() => {
    const obj = {};
    for (const [gid, info] of downloadsRef.current) {
      obj[gid] = info;
    }
    setDownloads(obj);
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/torrent-downloads`);

        ws.onopen = async () => {
          console.log('[DOWNLOADS] WebSocket connected');
          wsRef.current = ws;

          // Fetch initial state
          try {
            const response = await axios.get('/api/files/torrent-download');
            if (response.data.downloads && Array.isArray(response.data.downloads)) {
              downloadsRef.current.clear();
              for (const dl of response.data.downloads) {
                downloadsRef.current.set(dl.gid, {
                  gid: dl.gid,
                  name: dl.name,
                  path: dl.path || '', // Use relative path from backend
                  progress: dl.progress || 0,
                  status: dl.status || 'active',
                  downloadSpeed: dl.downloadSpeed || '0 B/s',
                  uploadSpeed: dl.uploadSpeed || '0 B/s',
                  seeders: dl.seeders || 0,
                  peers: dl.peers || 0,
                  isTorrent: dl.isTorrent || false,
                  error: dl.error || null,
                });
              }
              syncDownloads();
            }
          } catch (err) {
            console.warn('[DOWNLOADS] Failed to fetch initial download state:', err.message);
          }
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'connected') {
              console.log('[DOWNLOADS]', message.message);
            } else if (message.type === 'download-progress') {
              // Update download progress in real-time
              const { payload } = message;
              const existing = downloadsRef.current.get(payload.gid);
              if (existing) {
                downloadsRef.current.set(payload.gid, {
                  ...existing,
                  ...payload,
                });
                syncDownloads();
              }
            } else if (message.type === 'download-added') {
              const { payload } = message;
              const existing = downloadsRef.current.get(payload.gid);
              downloadsRef.current.set(payload.gid, {
                ...existing,
                gid: payload.gid,
                name: payload.name || 'Unknown',
                path: payload.path || '',
                progress: payload.progress || 0,
                status: payload.status || 'active',
                downloadSpeed: payload.downloadSpeed || '0 B/s',
                uploadSpeed: payload.uploadSpeed || '0 B/s',
                seeders: payload.seeders || 0,
                peers: payload.peers || 0,
                isTorrent: payload.isTorrent || false,
                error: payload.error || null,
              });
              syncDownloads();
            } else if (message.type === 'downloads-status') {
              const { downloads: downloadsList } = message.payload;
              if (Array.isArray(downloadsList)) {
                for (const dl of downloadsList) {
                  const existing = downloadsRef.current.get(dl.gid);
                  downloadsRef.current.set(dl.gid, {
                    ...existing,
                    gid: dl.gid,
                    name: dl.name || 'Unknown',
                    path: dl.path || '', // Include path from backend
                    progress: dl.progress || 0,
                    status: dl.status || 'active',
                    downloadSpeed: dl.downloadSpeed || '0 B/s',
                    uploadSpeed: dl.uploadSpeed || '0 B/s',
                    seeders: dl.seeders || 0,
                    peers: dl.peers || 0,
                    isTorrent: dl.isTorrent || false,
                    error: dl.error || null,
                  });
                }
              }
              syncDownloads();
            } else if (message.type === 'download-paused') {
              const { gid } = message.payload;
              const existing = downloadsRef.current.get(gid);
              if (existing) {
                downloadsRef.current.set(gid, { ...existing, status: 'paused' });
                syncDownloads();
              }
            } else if (message.type === 'download-resumed') {
              const { gid } = message.payload;
              const existing = downloadsRef.current.get(gid);
              if (existing) {
                downloadsRef.current.set(gid, { ...existing, status: 'active' });
                syncDownloads();
              }
            } else if (message.type === 'download-removed') {
              const { gid } = message.payload;
              downloadsRef.current.delete(gid);
              syncDownloads();
            } else if (message.type === 'download-complete') {
              // Download completed - remove from downloads list
              const { gid, targetPath } = message.payload;
              downloadsRef.current.delete(gid);
              syncDownloads();

              // Trigger file browser refresh event
              window.dispatchEvent(new CustomEvent('torrent-download-complete', {
                detail: { path: targetPath }
              }));
              console.log('[DOWNLOADS] Download completed, file browser should refresh:', targetPath);
            }
          } catch (err) {
            console.error('[DOWNLOADS] Error processing WebSocket message:', err);
          }
        };

        ws.onerror = (err) => {
          console.error('[DOWNLOADS] WebSocket error:', err);
        };

        ws.onclose = () => {
          console.log('[DOWNLOADS] WebSocket disconnected, reconnecting in 3s...');
          wsRef.current = null;
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
        };
      } catch (err) {
        console.error('[DOWNLOADS] Failed to connect WebSocket:', err);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [syncDownloads]);

  // Add a download to the tracked map (called when user starts a download from UI)
  const addDownload = useCallback((gid, name, path) => {
    downloadsRef.current.set(gid, {
      gid,
      name,
      path,
      progress: 0,
      status: 'active',
      downloadSpeed: '0 B/s',
      uploadSpeed: '0 B/s',
      seeders: 0,
      peers: 0,
      isTorrent: name.toLowerCase().endsWith('.torrent') || false,
      error: null,
    });
    syncDownloads();
  }, [syncDownloads]);

  // Pause a download
  const pauseDownload = useCallback(async (gid) => {
    try {
      await axios.patch('/api/files/torrent-download', { gid, action: 'pause' });
    } catch (err) {
      console.error('[DOWNLOADS] Failed to pause download:', err.message);
      throw err;
    }
  }, []);

  // Resume a download
  const resumeDownload = useCallback(async (gid) => {
    try {
      await axios.patch('/api/files/torrent-download', { gid, action: 'resume' });
    } catch (err) {
      console.error('[DOWNLOADS] Failed to resume download:', err.message);
      throw err;
    }
  }, []);

  // Remove a download
  const removeDownload = useCallback(async (gid) => {
    try {
      await axios.patch('/api/files/torrent-download', { gid, action: 'remove' });
    } catch (err) {
      console.error('[DOWNLOADS] Failed to remove download:', err.message);
      throw err;
    }
  }, []);

  return {
    downloads,
    addDownload,
    pauseDownload,
    resumeDownload,
    removeDownload,
  };
}
