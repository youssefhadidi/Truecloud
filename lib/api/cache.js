/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch cache statistics
 */
export function useGetCacheStats() {
  return useQuery({
    queryKey: ['cache-stats'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/cache');
      return {
        caches: response.data.caches,
        totalSizeFormatted: response.data.totalSizeFormatted,
      };
    },
  });
}

/**
 * Hook to clear cache
 */
export function useClearCache() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (type) => {
      const response = await axios.delete(`/api/admin/cache?type=${type}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-stats'] });
    },
  });
}

/**
 * Hook to generate cache
 */
export function useGenerateCache() {
  return useMutation({
    mutationFn: async ({ path, type }) => {
      const response = await axios.post('/api/admin/cache/generate', { path, type });
      return response.data;
    },
  });
}

/**
 * Hook to stop cache generation
 */
export function useStopCacheGeneration() {
  return useMutation({
    mutationFn: async () => {
      const response = await axios.delete('/api/admin/cache/generate');
      return response.data;
    },
  });
}
