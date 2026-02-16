/** @format */

import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * React Query-based session hook that replaces useSession() for polling.
 * Uses structural sharing so re-renders only happen when session data actually changes.
 */
export function useStableSession() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const res = await fetch('/api/auth/session');
      if (!res.ok) return null;
      const session = await res.json();
      // Return null if empty session (not authenticated)
      return session?.user ? session : null;
    },
    refetchInterval: 30 * 1000, // poll every 30 seconds
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const status = isLoading ? 'loading' : data?.user ? 'authenticated' : 'unauthenticated';

  // Trigger a refetch (replacement for updateSession)
  const update = () => queryClient.invalidateQueries({ queryKey: ['session'] });

  return { data, status, update };
}
