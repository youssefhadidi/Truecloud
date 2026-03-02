/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const res = await axios.get('/api/system/jobs');
      return res.data.jobs;
    },
    staleTime: Infinity, // WebSocket keeps data fresh
  });
}

export function useJob(id) {
  return useQuery({
    queryKey: ['jobs', id],
    queryFn: async () => {
      const res = await axios.get(`/api/system/jobs/${id}`);
      return res.data.job;
    },
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const res = await axios.delete(`/api/system/jobs/${id}`);
      return res.data.job;
    },
    onSuccess: (job) => {
      queryClient.setQueryData(['jobs', job.id], job);
      queryClient.setQueryData(['jobs'], (prev) =>
        prev ? prev.map((j) => (j.id === job.id ? job : j)) : [job],
      );
    },
  });
}
