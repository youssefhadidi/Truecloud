/** @format */

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useWebSocket } from '@/contexts/WebSocketContext';

/**
 * Hook to receive real-time logs via unified WebSocket
 *
 * Subscribes to 'logs' messages from the app-level WebSocket connection.
 * On initial mount, fetches all historical logs via API.
 * Then receives new logs in real-time through WebSocket.
 *
 * Returns:
 * - logs: Array of all log lines (historical + new)
 * - isLoading: Boolean indicating initial load state
 * - error: Error message if any
 */
export function useLogsStream() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const { subscribe } = useWebSocket();

  // Fetch initial logs from API
  useEffect(() => {
    const fetchInitialLogs = async () => {
      try {
        setError(null);
        const response = await axios.get('/api/system/logs');

        if (response.data.success) {
          // Load all historical lines
          setLogs(response.data.allLines || []);
          setIsLoading(false);
        } else {
          setError(response.data.error || 'Failed to load logs');
          setIsLoading(false);
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load logs');
        console.error('[LOGS] Error fetching initial logs:', err);
        setIsLoading(false);
      }
    };

    fetchInitialLogs();
  }, []);

  // Subscribe to real-time log updates via WebSocket
  useEffect(() => {
    const unsubscribe = subscribe('logs', (message) => {
      try {
        const { newLines } = message.payload;

        if (newLines && Array.isArray(newLines)) {
          // Append new lines to existing logs
          setLogs((prevLogs) => [...prevLogs, ...newLines]);
        }
      } catch (err) {
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
