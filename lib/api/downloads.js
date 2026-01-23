/** @format */

import { useQuery, useMutation } from '@tanstack/react-query';
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
 * Hook to start a torrent download
 */
export function useStartTorrentDownload() {
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
