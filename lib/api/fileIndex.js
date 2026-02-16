/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch file index stats
 */
export function useFileIndexStats() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['fileIndexStats'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/file-index/stats');
      return response.data;
    },
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
 * Hook to rebuild file index
 */
export function useRebuildFileIndex() {
  return useMutation({
    mutationFn: async () => {
      const response = await axios.post('/api/admin/file-index/rebuild');
      return response.data;
    },
  });
}

/**
 * Hook to clear file index
 */
export function useClearFileIndex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await axios.delete('/api/admin/file-index');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fileIndexStats'] });
    },
  });
}
