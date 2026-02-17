/** @format */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch system logs
 */
export function useLogs() {
  return useQuery({
    queryKey: ['logs'],
    queryFn: async () => {
      const response = await axios.get('/api/system/logs');
      return response.data;
    },
    // Don't refetch on window focus since logs are streamed via WebSocket
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
