/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function useFolderLocks(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['admin', 'folder-locks'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/folder-locks');
      return response.data.locks || [];
    },
    enabled,
  });

  return {
    data,
    isPending,
    isFetching,
    isLoading: isPending && !data,
    ...rest,
  };
}

export function useSetFolderLock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, pin }) => {
      const response = await axios.post('/api/admin/folder-locks', { path, pin });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'folder-locks'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useChangeFolderLockPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, pin }) => {
      const response = await axios.put(`/api/admin/folder-locks/${encodeURIComponent(path)}`, { pin });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'folder-locks'] });
    },
  });
}

export function useDeleteFolderLock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path) => {
      const response = await axios.delete(`/api/admin/folder-locks/${encodeURIComponent(path)}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'folder-locks'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}
