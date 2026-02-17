/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * React Query-based session hook that replaces useSession() for polling.
 * Uses structural sharing so re-renders only happen when session data actually changes.
 */
export function useStableSession() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const response = await axios.get('/api/auth/session');
        // Return null if empty session (not authenticated)
        return response.data?.user ? response.data : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 30 * 1000, // poll every 30 seconds
    staleTime: 30 * 1000, // match refetchInterval to prevent unnecessary background refetches
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false, // session is unlikely to change on window focus
  });

  const status = isLoading ? 'loading' : data?.user ? 'authenticated' : 'unauthenticated';

  // Trigger a refetch (replacement for updateSession)
  const update = () => queryClient.invalidateQueries({ queryKey: ['session'] });

  return { data, status, update };
}

/**
 * Hook to verify PIN for session unlock
 */
export function useVerifyPin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pin) => {
      const response = await axios.post('/api/account/verify-pin', { pin });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate session to refresh lock status
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

/**
 * Hook to lock the current session
 */
export function useLockAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await axios.post('/api/account/lock');
      return response.data;
    },
    onSuccess: () => {
      // Invalidate session to refresh lock status
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

/**
 * Hook to update account settings (session lock settings)
 */
export function useUpdateAccountSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings) => {
      const response = await axios.put('/api/account/settings', settings);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate session to refresh settings
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
