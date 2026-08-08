/**
 * Hook for real-time torrent download tracking via unified WebSocket.
 *
 * This is the primary download state management hook, used by both the
 * file browser (useFilesPage) and the downloads management page.
 *
 * DATA FLOW:
 * 1. Seeds from initialDownloads (from API) whenever they arrive — live
 *    WebSocket state always wins over a seed for the same gid
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
 *
 * @format
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';
import { usePauseDownload, useResumeDownload, useRemoveDownload } from '@/lib/api/downloads';

const DOWNLOAD_DEFAULTS = {
  name: 'Unknown',
  path: '', // relative path, used to filter downloads per browsed directory
  progress: 0,
  status: 'active',
  downloadSpeed: '0 B/s',
  uploadSpeed: '0 B/s',
  downloaded: '0 B',
  totalSize: '—',
  seeders: 0,
  peers: 0,
  isTorrent: false,
  error: null,
};

/**
 * Merge a download record over the entry we already hold.
 *
 * Every record arrives as JSON (API response or WebSocket frame), so a field the
 * backend omits is an absent key rather than an explicit undefined — spreading
 * therefore keeps the previous value instead of resetting it to the default.
 */
function mergeDownload(existing, record) {
  return { ...DOWNLOAD_DEFAULTS, ...existing, ...record };
}

export function useActiveDownloads(initialDownloads = []) {
  const downloadsRef = useRef(new Map()); // Map<gid, downloadInfo>
  const [downloads, setDownloads] = useState({});
  const rafPendingRef = useRef(false); // RAF flush is scheduled
  const { subscribe } = useWebSocket(); // Call hook at top level
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const pauseMutation = usePauseDownload();
  const resumeMutation = useResumeDownload();
  const removeMutation = useRemoveDownload();

  // Kept in a ref rather than read straight from the closure: addNotification
  // gets a fresh identity every time a toast is shown, so depending on it in the
  // subscription effect below would tear down and re-open the WebSocket
  // subscription on each notification.
  const notifyCompleteRef = useRef(null);
  useEffect(() => {
    notifyCompleteRef.current = (name) => addNotification('success', t('notify.downloadCompleted', { name }));
  }, [addNotification, t]);

  // Sync downloads map to state
  const syncDownloads = useCallback(() => {
    const obj = {};
    for (const [gid, info] of downloadsRef.current) {
      obj[gid] = info;
    }
    setDownloads(obj);
  }, []);

  // Batches high-frequency progress updates — flushes once per animation frame
  const scheduleSync = useCallback(() => {
    if (!rafPendingRef.current) {
      rafPendingRef.current = true;
      requestAnimationFrame(() => {
        rafPendingRef.current = false;
        syncDownloads();
      });
    }
  }, [syncDownloads]);

  // Seed with downloads fetched from the API (they may arrive after mount, and
  // again on a refetch). Only gids we haven't heard of are added, so a seed can
  // never roll back or clobber fresher WebSocket state.
  useEffect(() => {
    if (!Array.isArray(initialDownloads) || initialDownloads.length === 0) return;

    let seeded = false;
    for (const dl of initialDownloads) {
      if (!dl?.gid || downloadsRef.current.has(dl.gid)) continue;
      downloadsRef.current.set(dl.gid, mergeDownload(null, dl));
      seeded = true;
    }
    // Flushed on the next frame rather than synchronously: a seed must not
    // cascade a second render out of the effect that produced it.
    if (seeded) scheduleSync();
  }, [initialDownloads, scheduleSync]);

  // Subscribe to torrent-downloads messages from unified WebSocket
  useEffect(() => {
    const unsubscribe = subscribe('torrent-downloads', (message) => {
      try {
        // server.js wraps each producer event once more before it reaches the
        // browser, so the frame is:
        //   { type: 'torrent-downloads', payload: { type, payload: <data> } }
        // The download fields live in that inner payload, not one level up. The
        // fallback covers a producer that puts them on the event itself.
        const inner = message.payload || {};
        const { type } = inner;
        const data = inner.payload || inner;
        const { gid } = data;

        if (type === 'download-progress') {
          // Progress frames carry the full record, so an unknown gid (a download
          // started before this page mounted, or from another client) is upserted
          // rather than dropped.
          if (gid) {
            downloadsRef.current.set(gid, mergeDownload(downloadsRef.current.get(gid), data));
            scheduleSync(); // batched — avoids a setState per-second per-download
          }
        } else if (type === 'download-added') {
          if (gid) {
            downloadsRef.current.set(gid, mergeDownload(downloadsRef.current.get(gid), data));
            syncDownloads();
          }
        } else if (type === 'downloads-status') {
          const { downloads: downloadsList } = data;
          if (Array.isArray(downloadsList)) {
            for (const dl of downloadsList) {
              if (!dl?.gid) continue;
              downloadsRef.current.set(dl.gid, mergeDownload(downloadsRef.current.get(dl.gid), dl));
            }
            syncDownloads();
          }
        } else if (type === 'download-paused') {
          const existing = downloadsRef.current.get(gid);
          if (existing) {
            downloadsRef.current.set(gid, { ...mergeDownload(existing, data), status: 'paused' });
            syncDownloads();
          }
        } else if (type === 'download-resumed') {
          const existing = downloadsRef.current.get(gid);
          if (existing) {
            downloadsRef.current.set(gid, { ...mergeDownload(existing, data), status: 'active' });
            syncDownloads();
          }
        } else if (type === 'download-removed') {
          downloadsRef.current.delete(gid);
          syncDownloads();
        } else if (type === 'download-complete') {
          if (gid) {
            const existing = downloadsRef.current.get(gid);
            // The completion frame carries the finished record, so a client that
            // never saw the transfer still gets a named row. The entry is kept:
            // the service holds finished downloads as history until dismissed.
            downloadsRef.current.set(gid, { ...mergeDownload(existing, data), status: 'complete', progress: 100 });
            syncDownloads();
            // Guarded on the previous status so a repeated frame can't toast twice.
            if (existing?.status !== 'complete') notifyCompleteRef.current?.(data.name || existing?.name);
          }
        }
      } catch (err) {
        console.error('[DOWNLOADS] Error processing WebSocket message:', err);
      }
    });

    return unsubscribe;
  }, [subscribe, syncDownloads, scheduleSync]);

  // Add a download to the tracked map (called when user starts a download from UI)
  const addDownload = useCallback(
    (gid, name, path) => {
      downloadsRef.current.set(
        gid,
        mergeDownload(null, {
          gid,
          name,
          path,
          isTorrent: name.toLowerCase().endsWith('.torrent'),
        }),
      );
      syncDownloads();
    },
    [syncDownloads],
  );

  // Pause a download
  const pauseDownload = useCallback(
    async (gid) => {
      try {
        await pauseMutation.mutateAsync(gid);
      } catch (err) {
        console.error('[DOWNLOADS] Failed to pause download:', err.message);
        throw err;
      }
    },
    [pauseMutation],
  );

  // Resume a download
  const resumeDownload = useCallback(
    async (gid) => {
      try {
        await resumeMutation.mutateAsync(gid);
      } catch (err) {
        console.error('[DOWNLOADS] Failed to resume download:', err.message);
        throw err;
      }
    },
    [resumeMutation],
  );

  // Remove a download. Resolves with { filesDeleted } so the caller can say
  // whether this dismissed history or deleted an unfinished download's data.
  const removeDownload = useCallback(
    async (gid) => {
      try {
        return await removeMutation.mutateAsync(gid);
      } catch (err) {
        console.error('[DOWNLOADS] Failed to remove download:', err.message);
        throw err;
      }
    },
    [removeMutation],
  );

  return {
    downloads,
    addDownload,
    pauseDownload,
    resumeDownload,
    removeDownload,
  };
}
