/** @format */

import { useEffect, useState } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Hook to listen for real-time file indexing progress via WebSocket
 *
 * Subscribes to 'file-index' messages from the app-level WebSocket connection.
 * Returns the current indexing status (progress, total, done, error).
 *
 * Example:
 * const { progress, total, done, error } = useFileIndexing();
 */
export function useFileIndexing() {
  const { subscribe } = useWebSocket();
  const [status, setStatus] = useState({
    processed: 0,
    total: 0,
    done: false,
    error: null,
  });

  useEffect(() => {
    // Subscribe to file-index messages
    const unsubscribe = subscribe('file-index', (message) => {
      try {
        const { type, payload } = message;

        if (type === 'progress') {
          setStatus({
            processed: payload.processed || 0,
            total: payload.total || 0,
            done: false,
            error: null,
          });
        } else if (type === 'done') {
          setStatus({
            processed: payload.total || 0,
            total: payload.total || 0,
            done: true,
            error: null,
          });
        } else if (type === 'error') {
          setStatus((prev) => ({
            ...prev,
            done: true,
            error: payload.error || 'Unknown error',
          }));
        }
      } catch (err) {
        console.error('[FILE INDEXING] Error processing message:', err);
        setStatus((prev) => ({
          ...prev,
          done: true,
          error: err.message,
        }));
      }
    });

    return unsubscribe;
  }, [subscribe]);

  return status;
}
