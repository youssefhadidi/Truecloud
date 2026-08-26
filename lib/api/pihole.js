/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

const BASE = '/api/admin/pihole';

export const piholeKeys = {
  status: ['pihole', 'status'],
  preflight: ['pihole', 'preflight'],
  stats: ['pihole', 'stats'],
  config: ['pihole', 'config'],
  lists: (type) => ['pihole', 'lists', type],
  domains: (type, kind) => ['pihole', 'domains', type, kind],
  queries: (filters) => ['pihole', 'queries', filters],
};

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export function usePiholeStatus() {
  return useQuery({
    queryKey: piholeKeys.status,
    queryFn: async () => {
      const { data } = await axios.get(BASE);
      return data;
    },
    staleTime: 15_000,
  });
}

/** Preflight for the guided installer — only meaningful when Pi-hole is absent. */
export function usePiholePreflight({ enabled = true } = {}) {
  return useQuery({
    queryKey: piholeKeys.preflight,
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/install`);
      return data;
    },
    staleTime: 10_000,
    enabled,
  });
}

export function usePiholeStats({ enabled = true } = {}) {
  return useQuery({
    queryKey: piholeKeys.stats,
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/stats`);
      return data;
    },
    staleTime: 15_000,
    enabled,
  });
}

export function usePiholeConfig({ enabled = true } = {}) {
  return useQuery({
    queryKey: piholeKeys.config,
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/config`);
      return data;
    },
    staleTime: 60_000,
    enabled,
  });
}

export function usePiholeLists(type = 'block', { enabled = true } = {}) {
  return useQuery({
    queryKey: piholeKeys.lists(type),
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/lists`, { params: { type } });
      return data;
    },
    staleTime: 30_000,
    enabled,
  });
}

export function usePiholeDomains(type = 'deny', kind = 'exact', { enabled = true } = {}) {
  return useQuery({
    queryKey: piholeKeys.domains(type, kind),
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/domains`, { params: { type, kind } });
      return data;
    },
    staleTime: 30_000,
    enabled,
  });
}

export function usePiholeQueries(filters = {}, { enabled = true, live = false } = {}) {
  return useQuery({
    queryKey: piholeKeys.queries(filters),
    queryFn: async () => {
      const { data } = await axios.get(`${BASE}/queries`, { params: filters });
      return data;
    },
    staleTime: live ? 0 : 10_000,
    refetchInterval: live ? 5_000 : false,
    placeholderData: (previous) => previous,
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                          */
/* ------------------------------------------------------------------ */

export function useSavePiholeConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await axios.put(BASE, payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(piholeKeys.status, data);
      queryClient.invalidateQueries({ queryKey: ['pihole'] });
    },
  });
}

/** Kick off the guided install. Resolves with `{ jobId }`; progress arrives over the job WebSocket. */
export function useInstallPihole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ webPort = '8080', upstreams } = {}) => {
      const { data } = await axios.post(`${BASE}/install`, { confirmed: true, webPort, upstreams });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.preflight });
    },
  });
}

export function useSetPiholeBlocking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ enabled, timer = null }) => {
      const { data } = await axios.post(`${BASE}/blocking`, { enabled, timer });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.status });
    },
  });
}

export function useAddPiholeList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ address, type = 'block', comment = '' }) => {
      const { data } = await axios.post(`${BASE}/lists`, { address, type, comment });
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.lists(variables.type ?? 'block') });
    },
  });
}

export function useUpdatePiholeList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ address, type = 'block', enabled, comment, groups }) => {
      const { data } = await axios.put(`${BASE}/lists`, { address, type, enabled, comment, groups });
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.lists(variables.type ?? 'block') });
    },
  });
}

export function useDeletePiholeList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ address, type = 'block' }) => {
      const { data } = await axios.delete(`${BASE}/lists`, { params: { address, type } });
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.lists(variables.type ?? 'block') });
    },
  });
}

export function useAddPiholeDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, type = 'deny', kind = 'exact', comment = '' }) => {
      const { data } = await axios.post(`${BASE}/domains`, { domain, type, kind, comment });
      return data;
    },
    onSuccess: (_data, v) => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.domains(v.type ?? 'deny', v.kind ?? 'exact') });
    },
  });
}

export function useDeletePiholeDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, type = 'deny', kind = 'exact' }) => {
      const { data } = await axios.delete(`${BASE}/domains`, { params: { domain, type, kind } });
      return data;
    },
    onSuccess: (_data, v) => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.domains(v.type ?? 'deny', v.kind ?? 'exact') });
    },
  });
}

export function useRunGravity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(`${BASE}/gravity`);
      return data;
    },
    onSuccess: () => {
      // Gravity runs in the background; refresh the domain counters once the
      // job has had a moment to finish.
      queryClient.invalidateQueries({ queryKey: ['pihole', 'lists'] });
    },
  });
}

export function useSavePiholeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await axios.patch(`${BASE}/config`, payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(piholeKeys.config, data);
    },
  });
}

export function useRestartPiholeDns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(`${BASE}/restart`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: piholeKeys.status });
    },
  });
}
