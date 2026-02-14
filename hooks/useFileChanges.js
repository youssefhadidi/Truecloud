/** @format */

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Hook to listen for real-time file changes via unified WebSocket
 *
 * Subscribes to 'file-change' messages from the app-level WebSocket connection.
 * Automatically invalidates React Query cache for affected paths.
 * Skips invalidation for changes made by the current user to avoid double invalidation.
 */
export function useFileChanges() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const sessionRef = useRef(session);

  // Keep sessionRef in sync with session
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    // Subscribe to file-change messages
    const unsubscribe = subscribe('file-change', (message) => {
      try {
        const { path, userId } = message.payload;

        // Skip invalidation for changes made by current user (avoid double invalidation)
        const currentUserId = sessionRef.current?.user?.id;
        if (currentUserId && userId === currentUserId) {
          return;
        }

        // Invalidate the cache for the affected path
        // This will trigger a refetch of the files list
        queryClient.invalidateQueries({ queryKey: ['files', path] });

        // Also invalidate parent directories for better UX
        // For example, if a file changes in 'folder/subfolder', also invalidate 'folder'
        if (path && path.includes('/')) {
          const parentPath = path.substring(0, path.lastIndexOf('/'));
          if (parentPath) {
            queryClient.invalidateQueries({ queryKey: ['files', parentPath] });
          }
        }
      } catch (err) {
        console.error('[FILE CHANGES] Error processing message:', err);
      }
    });

    return unsubscribe;
  }, [subscribe, queryClient]);
}
