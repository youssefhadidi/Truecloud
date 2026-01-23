/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch active torrent downloads
 */
export function useTorrentDownloads() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['torrentDownloads'],
    queryFn: async () => {
      const response = await axios.get('/api/files/torrent-download');
      return response.data.downloads || [];
    },
    refetchInterval: 2000, // Poll every 2 seconds for live progress
  });

  const isLoading = isPending && !data;

  return {
    data,
    isPending,
    isLoading,
    ...rest,
  };
}

/**
 * Hook to start a download (HTTP, torrent, or magnet)
 */
export function useStartDownload() {
  return useMutation({
    mutationFn: async (formData) => {
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
 * Hook to pause a download
 */
export function usePauseDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', {
        gid,
        action: 'pause',
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['torrentDownloads'] });
    },
  });
}

/**
 * Hook to resume a download
 */
export function useResumeDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', {
        gid,
        action: 'resume',
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['torrentDownloads'] });
    },
  });
}

/**
 * Hook to remove a download
 */
export function useRemoveDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (gid) => {
      const response = await axios.patch('/api/files/torrent-download', {
        gid,
        action: 'remove',
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['torrentDownloads'] });
    },
  });
}
