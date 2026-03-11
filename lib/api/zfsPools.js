/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch all ZFS pools
 */
export function useZfsPools(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['zfs-pools'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/zfs-pools');
      return response.data.pools || [];
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
 * Hook to fetch detailed info for a specific ZFS pool
 */
export function useZfsPoolDetail(name, enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['zfs-pool', name],
    queryFn: async () => {
      if (!name) throw new Error('Pool name is required');
      const response = await axios.get(`/api/admin/zfs-pools/${name}`);
      return response.data;
    },
    enabled: enabled && !!name,
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
 * Hook to fetch available disks for pool creation
 */
export function useAvailableDisks(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['zfs-disks'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/zfs-pools/disks');
      return response.data.disks || [];
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
 * Hook to add a cache (L2ARC) device to an existing ZFS pool
 */
export function useAddCacheDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ poolName, device }) => {
      const response = await axios.post(`/api/admin/zfs-pools/${poolName}/cache`, { device });
      return response.data;
    },
    onSuccess: (_, { poolName }) => {
      queryClient.invalidateQueries({ queryKey: ['zfs-pools'] });
      queryClient.invalidateQueries({ queryKey: ['zfs-pool', poolName] });
      queryClient.invalidateQueries({ queryKey: ['zfs-disks'] });
    },
  });
}

/**
 * Hook to create a new ZFS pool
 */
export function useCreateZfsPool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (poolData) => {
      const response = await axios.post('/api/admin/zfs-pools', poolData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zfs-pools'] });
    },
  });
}
