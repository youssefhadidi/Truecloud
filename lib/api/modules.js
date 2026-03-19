/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch installed modules
 */
export function useModules() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['modules'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/modules');
      return response.data.modules || [];
    },
  });

  const isLoading = isPending && !data;

  return { data, isPending, isLoading, ...rest };
}

/**
 * Hook to install a module from a git repository
 */
export function useAddModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (repository) => {
      const response = await axios.post('/api/admin/modules', { repository });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}

/**
 * Hook to remove an installed module
 */
export function useRemoveModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, deleteDatabase = false }) => {
      const response = await axios.delete(`/api/admin/modules/${name}`, {
        params: deleteDatabase ? { deleteDatabase: 'true' } : {},
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}

/**
 * Hook to update a module (re-clone latest from git)
 */
export function useUpdateModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name) => {
      const response = await axios.put(`/api/admin/modules/${name}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}
