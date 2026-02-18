/** @format */

/**
 * React Query hooks for torrent download operations.
 *
 * ARCHITECTURE NOTE:
 * Real-time download status (progress, pause, resume, completion) is handled
 * via WebSocket in the useActiveDownloads hook (hooks/useActiveDownloads.js).
 * This file only contains the mutation hook for STARTING new downloads (POST).
 * Pause/resume/remove actions are handled via useActiveDownloads, which makes
 * direct axios calls and receives status updates back through WebSocket.
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to start a new torrent download (magnet link or .torrent file upload).
 * Sends a POST request with FormData to /api/files/torrent-download.
 *
 * NOTE: Cache invalidation is NOT done here because the download is just starting.
 * Files won't appear in the directory until the download completes. The actual
 * cache invalidation happens via the 'torrent-download-complete' WebSocket event
 * in useFilesPage, which fires when files actually finish writing to disk.
 */
export function useStartDownload() {
  return useMutation({
    mutationFn: async (input) => {
      // Handle both legacy (formData) and new ({ formData, path }) signatures
      const formData = input instanceof FormData ? input : input.formData;
      const path = input instanceof FormData ? '' : (input.path || '');

      // Add path to formData if provided
      if (path && !(formData instanceof FormData)) {
        formData.append('path', path);
      } else if (path) {
        formData.append('path', path);
      }

      const response = await axios.post('/api/files/torrent-download', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
  });
}

/**
 * @deprecated Use useStartDownload instead
 */
export function useStartTorrentDownload() {
  return useStartDownload();
}

/**
 * Hook to fetch all active downloads
 */
export function useGetDownloads() {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: async () => {
      const response = await axios.get('/api/files/torrent-download');
      return response.data.downloads || [];
    },
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to pause a download
 */
export function usePauseDownload() {
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', { gid, action: 'pause' });
      return response.data;
    },
  });
}

/**
 * Hook to resume a download
 */
export function useResumeDownload() {
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', { gid, action: 'resume' });
      return response.data;
    },
  });
}

/**
 * Hook to remove a download
 */
export function useRemoveDownload() {
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', { gid, action: 'remove' });
      return response.data;
    },
  });
}
