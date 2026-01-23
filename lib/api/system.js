/** @format */

import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch system requirements
 */
export function useSystemRequirements() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['systemRequirements'],
    queryFn: async () => {
      const response = await axios.get('/api/system/check-requirements');
      return response.data.requirements || [];
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
 * Hook to install a system requirement
 */
export function useInstallRequirement() {
  return useMutation({
    mutationFn: async (name) => {
      const response = await axios.post('/api/system/install-requirement', { name });
      return response.data;
    },
  });
}

/**
 * Hook to check for updates
 */
export function useCheckUpdates(enabled = false) {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['checkUpdates'],
    queryFn: async () => {
      const response = await axios.get('/api/system/check-updates');
      return response.data;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
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
 * Hook to run update
 */
export function useRunUpdate() {
  return useMutation({
    mutationFn: async () => {
      const response = await axios.post('/api/system/run-update');
      return response.data;
    },
  });
}
