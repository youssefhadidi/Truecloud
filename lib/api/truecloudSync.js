/** @format */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function useTruecloudSync() {
  return useQuery({
    queryKey: ['truecloud-sync'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/truecloud-sync');
      return data;
    },
    staleTime: 30_000,
  });
}
