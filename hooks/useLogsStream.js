/** @format */

import { useEffect, useState, useRef } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Hook to receive real-time logs via unified WebSocket
 *
 * Subscribes to 'logs' messages from the app-level WebSocket connection.
 * First message contains allLines (last 50 lines), subsequent messages contain newLines.
 * All data flows through WebSocket - no API calls.
 *
 * Returns:
 * - logs: Array of all log lines
 * - isLoading: Boolean indicating initial load state
 * - error: Error message if any
 */
export function useLogsStream() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const { subscribe } = useWebSocket();
  const initialLoadedRef = useRef(false);

  // Subscribe to real-time log updates via WebSocket
  useEffect(() => {
    const unsubscribe = subscribe('logs', (message) => {
      try {
        const { allLines, newLines } = message.payload;

        // First message contains allLines (initial load)
        if (!initialLoadedRef.current && allLines && Array.isArray(allLines)) {
          setLogs(allLines);
          setIsLoading(false);
          initialLoadedRef.current = true;
        }
        // Subsequent messages contain newLines to append
        else if (newLines && Array.isArray(newLines)) {
          setLogs((prevLogs) => [...prevLogs, ...newLines]);
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
    isLoading,
    error,
  };
}
