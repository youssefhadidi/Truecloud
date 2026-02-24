/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch all SMB shares
 */
export function useSmbShares(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['smb-shares'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/smb-shares');
      return response.data.shares || [];
    },
    enabled,
  });

  const isLoading = isPending && !data;

  return {
    data,
    isPending,
    isFetching,
    isLoading,
    ...rest,
  };
}

/**
 * Hook to create a new SMB share
 */
export function useCreateSmbShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareData) => {
      const response = await axios.post('/api/admin/smb-shares', shareData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-shares'] });
    },
  });
}

/**
 * Hook to update an SMB share
 */
export function useUpdateSmbShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareData) => {
      const response = await axios.patch('/api/admin/smb-shares', shareData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-shares'] });
    },
  });
}

/**
 * Hook to delete an SMB share
 */
export function useDeleteSmbShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareId) => {
      const response = await axios.delete(`/api/admin/smb-shares?id=${shareId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-shares'] });
    },
  });
}
