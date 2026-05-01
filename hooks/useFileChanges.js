/** @format */

import { useEffect, useRef } from 'react';
import { useStableSession } from '@/lib/api/session';
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
  const { data: session } = useStableSession();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const sessionRef = useRef(session);
  const pendingPathsRef = useRef(new Set());
  const flushTimerRef = useRef(null);

  // Keep sessionRef in sync with session
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const flushInvalidations = () => {
      for (const p of pendingPathsRef.current) {
        queryClient.invalidateQueries({ queryKey: ['files', p] });
      }
      pendingPathsRef.current.clear();
    };

    const unsubscribe = subscribe('file-change', (message) => {
      try {
        const { path, userId } = message.payload;

        const currentUserId = sessionRef.current?.user?.id;
        if (currentUserId && userId === currentUserId) {
          return;
        }

        pendingPathsRef.current.add(path);
        if (path && path.includes('/')) {
          const parentPath = path.substring(0, path.lastIndexOf('/'));
          if (parentPath) pendingPathsRef.current.add(parentPath);
        }

        // Batch invalidations — flush once after 300 ms of quiet
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushInvalidations, 300);
      } catch (err) {
        console.error('[FILE CHANGES] Error processing message:', err);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(flushTimerRef.current);
    };
  }, [subscribe, queryClient]);
}
