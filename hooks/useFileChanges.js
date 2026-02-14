/** @format */

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook to listen for real-time file changes via WebSocket
 *
 * Connects to /api/ws and listens for file-change messages.
 * Automatically invalidates React Query cache for affected paths.
 * Skips invalidation for changes made by the current user to avoid double invalidation.
 */
export function useFileChanges() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

        ws.onopen = () => {
          wsRef.current = ws;
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'file-change') {
              const { operation, path, fileName, userId } = message;

              // Skip invalidation for changes made by current user (avoid double invalidation)
              const currentUserId = session?.user?.id;
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
            }
          } catch (err) {
            console.error('[FILE CHANGES] Error processing message:', err);
          }
        };

        ws.onerror = (err) => {
          console.error('[FILE CHANGES] WebSocket error:', err);
        };

        ws.onclose = () => {
          wsRef.current = null;
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
        };
      } catch (err) {
        console.error('[FILE CHANGES] Failed to connect WebSocket:', err);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [queryClient, session]);
}
