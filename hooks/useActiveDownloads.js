/**
 * Hook for real-time torrent download tracking via unified WebSocket.
 *
 * This is the primary download state management hook, used by both the
 * file browser (useFilesPage) and the downloads management page.
 *
 * DATA FLOW:
 * 1. On mount, initializes with provided initialDownloads (from API)
 * 2. Subscribes to 'torrent-downloads' messages from app-level WebSocket
 * 3. Receives real-time updates via subscribed messages:
 *    - download-progress: Updates progress every 1s
 *    - download-added: New download started
 *    - downloads-status: Batch update (poll or state refresh)
 *    - download-paused/resumed/removed/complete: Status changes
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
import { useWebSocket } from '@/contexts/WebSocketContext';
import { usePauseDownload, useResumeDownload, useRemoveDownload } from '@/lib/api/downloads';

export function useActiveDownloads(initialDownloads = []) {
  const downloadsRef = useRef(new Map()); // Map<gid, downloadInfo>
  const [downloads, setDownloads] = useState({});
  const { subscribe } = useWebSocket(); // Call hook at top level
  const pauseMutation = usePauseDownload();
  const resumeMutation = useResumeDownload();
  const removeMutation = useRemoveDownload();

  // Sync downloads map to state
  const syncDownloads = useCallback(() => {
    const obj = {};
    for (const [gid, info] of downloadsRef.current) {
      obj[gid] = info;
    }
    setDownloads(obj);
  }, []);

  // Initialize with provided downloads (from API or caller)
  useEffect(() => {
    if (initialDownloads && Array.isArray(initialDownloads)) {
      downloadsRef.current.clear();
      for (const dl of initialDownloads) {
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
  }, [initialDownloads, syncDownloads]);

  // Subscribe to torrent-downloads messages from unified WebSocket
  useEffect(() => {
    const unsubscribe = subscribe('torrent-downloads', (message) => {
      try {
        const { payload } = message;

        if (payload.type === 'download-progress') {
          // Update download progress in real-time
          const existing = downloadsRef.current.get(payload.gid);
          if (existing) {
            downloadsRef.current.set(payload.gid, {
              ...existing,
              ...payload,
            });
            syncDownloads();
          }
        } else if (payload.type === 'download-added') {
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
        } else if (payload.type === 'downloads-status') {
          const { downloads: downloadsList } = payload;
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
        } else if (payload.type === 'download-paused') {
          const existing = downloadsRef.current.get(payload.gid);
          if (existing) {
            downloadsRef.current.set(payload.gid, {
              ...existing,
              ...payload,
              status: 'paused',
            });
            syncDownloads();
          }
        } else if (payload.type === 'download-resumed') {
          const existing = downloadsRef.current.get(payload.gid);
          if (existing) {
            downloadsRef.current.set(payload.gid, {
              ...existing,
              ...payload,
              status: 'active',
            });
            syncDownloads();
          }
        } else if (payload.type === 'download-removed') {
          const { gid } = payload;
          downloadsRef.current.delete(gid);
          syncDownloads();
        } else if (payload.type === 'download-complete') {
          // Download completed - remove from downloads list
          const { gid, targetPath } = payload;
          downloadsRef.current.delete(gid);
          syncDownloads();

          // Trigger file browser refresh event
          window.dispatchEvent(new CustomEvent('torrent-download-complete', {
            detail: { path: targetPath }
          }));
        }
      } catch (err) {
        console.error('[DOWNLOADS] Error processing WebSocket message:', err);
      }
    });

    return unsubscribe;
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
      await pauseMutation.mutateAsync(gid);
    } catch (err) {
      console.error('[DOWNLOADS] Failed to pause download:', err.message);
      throw err;
    }
  }, [pauseMutation]);

  // Resume a download
  const resumeDownload = useCallback(async (gid) => {
    try {
      await resumeMutation.mutateAsync(gid);
    } catch (err) {
      console.error('[DOWNLOADS] Failed to resume download:', err.message);
      throw err;
    }
  }, [resumeMutation]);

  // Remove a download
  const removeDownload = useCallback(async (gid) => {
    try {
      await removeMutation.mutateAsync(gid);
    } catch (err) {
      console.error('[DOWNLOADS] Failed to remove download:', err.message);
      throw err;
    }
  }, [removeMutation]);

  return {
    downloads,
    addDownload,
    pauseDownload,
    resumeDownload,
    removeDownload,
  };
}
