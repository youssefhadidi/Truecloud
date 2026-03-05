/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch all Minecraft servers
 */
export function useMinecraftServers(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['minecraft-servers'],
    queryFn: async () => {
      const response = await axios.get('/api/admin/minecraft/servers');
      return response.data.servers || [];
    },
    enabled,
    refetchInterval: 10_000, // poll every 10s to catch status changes
  });

  const isLoading = isPending && !data;
  return { data, isPending, isFetching, isLoading, ...rest };
}

/**
 * Hook to fetch a single server's details and server.properties
 */
export function useMinecraftServer(id, enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['minecraft-server', id],
    queryFn: async () => {
      const response = await axios.get(`/api/admin/minecraft/servers/${id}`);
      return response.data;
    },
    enabled: enabled && !!id,
  });

  const isLoading = isPending && !data;
  return { data, isPending, isFetching, isLoading, ...rest };
}

/**
 * Hook to fetch buffered console logs for a server
 */
export function useMinecraftLogs(id, enabled = true) {
  const { data, ...rest } = useQuery({
    queryKey: ['minecraft-logs', id],
    queryFn: async () => {
      const response = await axios.get(`/api/admin/minecraft/servers/${id}/logs`);
      return response.data.lines || [];
    },
    enabled: enabled && !!id,
    refetchInterval: false, // logs come via WebSocket; this is just for initial load
  });

  return { data: data ?? [], ...rest };
}

/**
 * Hook to create a new Minecraft server
 */
export function useCreateMinecraftServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverData) => {
      const response = await axios.post('/api/admin/minecraft/servers', serverData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-servers'] });
    },
  });
}

/**
 * Hook to update server config (RAM, autoStart, properties)
 */
export function useUpdateMinecraftServer(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates) => {
      const response = await axios.put(`/api/admin/minecraft/servers/${id}`, updates);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-servers'] });
      queryClient.invalidateQueries({ queryKey: ['minecraft-server', id] });
    },
  });
}

/**
 * Hook to delete a Minecraft server
 */
export function useDeleteMinecraftServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const response = await axios.delete(`/api/admin/minecraft/servers/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-servers'] });
    },
  });
}

/**
 * Hook to start a server
 */
export function useStartMinecraftServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const response = await axios.post(`/api/admin/minecraft/servers/${id}/start`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-servers'] });
    },
  });
}

/**
 * Hook to stop a server
 */
export function useStopMinecraftServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const response = await axios.post(`/api/admin/minecraft/servers/${id}/stop`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-servers'] });
    },
  });
}

/**
 * Hook to send a console command to a running server
 */
export function useSendMinecraftCommand(id) {
  return useMutation({
    mutationFn: async (command) => {
      const response = await axios.post(`/api/admin/minecraft/servers/${id}/command`, { command });
      return response.data;
    },
  });
}

/**
 * Hook to fetch available PaperMC versions from the public API
 */
export function usePaperVersions() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['paper-versions'],
    queryFn: async () => {
      const response = await fetch('https://api.papermc.io/v2/projects/paper');
      if (!response.ok) throw new Error('Failed to fetch PaperMC versions');
      const json = await response.json();
      // Return versions in descending order (newest first)
      return [...(json.versions ?? [])].reverse();
    },
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });

  return { data: data ?? [], isPending, ...rest };
}

/**
 * Hook to import a world ZIP file
 */
export function useImportMinecraftWorld(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('world', file);
      const response = await axios.post(
        `/api/admin/minecraft/servers/${id}/world`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['minecraft-server', id] });
    },
  });
}
