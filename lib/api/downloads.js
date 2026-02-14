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

import { useMutation } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to start a new torrent download (magnet link or .torrent file upload).
 * Sends a POST request with FormData to /api/files/torrent-download.
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
