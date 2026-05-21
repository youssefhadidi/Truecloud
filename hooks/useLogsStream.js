/** @format */

import { useEffect, useState } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Hook to receive real-time logs via the unified WebSocket.
 *
 * The server only streams deltas (newLines) from the moment a subscriber
 * attaches — no history is replayed. The component builds its own scrollback
 * by appending each delta. The server only polls the log file while at least
 * one client is subscribed, so unmounting this hook stops the poll.
 */
export function useLogsStream() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe('logs', (message) => {
      try {
        const { newLines } = message.payload;
        if (newLines && Array.isArray(newLines)) {
          setLogs((prev) => [...prev, ...newLines]);
        }
      } catch (err) {
        setError('Error processing log message');
        console.error('[LOGS] Error processing log message:', err);
      }
    });

    return unsubscribe;
  }, [subscribe]);

  return {
    logs,
    isLoading: false,
    error,
  };
}
