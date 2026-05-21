/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function usePowerManagement() {
  return useQuery({
    queryKey: ['power-management'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/power-management');
      return data;
    },
    staleTime: 30_000,
  });
}

export function useApplyPowerManagement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await axios.put('/api/admin/power-management', payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['power-management'], data);
    },
  });
}
