/** @format */

/**
 * React Query hooks for searching the public torrent index.
 *
 * Searching is explicit rather than debounce-as-you-type: each query hits a
 * third-party index, so the hook stays disabled until `enabled` is set by the
 * component (on submit) and results are cached for a few minutes.
 */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function useTorrentSearch({ query, category = 0, sort = 'seeders', order = 'desc', page = 1, enabled = false }) {
  return useQuery({
    queryKey: ['torrent-search', query, category, sort, order, page],
    queryFn: async () => {
      const response = await axios.get('/api/files/torrent-search', {
        params: { q: query, cat: category, sort, order, page },
      });
      return response.data;
    },
    enabled: enabled && !!query && query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useTorrentDetails(id) {
  return useQuery({
    queryKey: ['torrent-details', id],
    queryFn: async () => {
      const response = await axios.get('/api/files/torrent-search', { params: { id } });
      return response.data;
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
