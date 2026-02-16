/** @format */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function useSearch(query) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      const response = await axios.get('/api/search', { params: { q: query } });
      return response.data.results || [];
    },
    enabled: !!query && query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
  });
}
