/** @format */

'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/lib/appVersion';

/**
 * Unified WebSocket Manager
 *
 * Maintains a single WebSocket connection to /api/ws at the app root level.
 * All components subscribe to specific message types through this provider.
 *
 * Authentication:
 * - Authenticated users: session cookie is sent automatically on upgrade
 * - Share visitors: call setShareCredentials(token, password) to connect with share auth
 *
 * Message types:
 * - 'file-change': File CRUD operations
 * - 'torrent-downloads': Download status updates
 * - 'update-status': System update progress
 * - 'cache-generation': Cache generation status
 * - 'file-index': File indexing progress (rebuilt from /api/admin/file-index/rebuild)
 */

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const subscribersRef = useRef(new Map()); // Map<messageType, Set<callbacks>>
  const reconnectTimeoutRef = useRef(null);
  const shareCredentialsRef = useRef(null);

  const sendToServer = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ v: APP_VERSION });
      if (shareCredentialsRef.current) {
        params.set('token', shareCredentialsRef.current.token);
        params.set('password', shareCredentialsRef.current.password);
      }
      const wsUrl = `${protocol}//${window.location.host}/api/ws?${params.toString()}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsRef.current = ws;
        setConnected(true);
        // Re-announce all active subscriptions so the server can resume any
        // server-driven polling (e.g. system-metrics) after a reconnect.
        subscribersRef.current.forEach((subscribers, messageType) => {
          if (subscribers.size > 0) {
            ws.send(JSON.stringify({ type: 'subscribe', channel: messageType }));
          }
        });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const messageType = message.type;

          // Route message to all subscribers of this type
          const subscribers = subscribersRef.current.get(messageType);
          if (subscribers) {
            subscribers.forEach((callback) => {
              try {
                callback(message);
              } catch (err) {
                console.error(`[WS] Error in subscriber for ${messageType}:`, err);
              }
            });
          }
        } catch (err) {
          console.error('[WS] Error parsing message:', err);
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };
    } catch (err) {
      console.error('[WS] Failed to connect WebSocket:', err);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    }
  }, []);

  useEffect(() => {
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
  }, [connectWebSocket]);

  /**
   * Set share credentials and reconnect the WebSocket with them.
   * Call this from the share page after the password is verified.
   */
  const setShareCredentials = useCallback(
    (token, password) => {
      shareCredentialsRef.current = { token, password };
      connectWebSocket();
    },
    [connectWebSocket],
  );

  /**
   * Subscribe to a specific message type.
   * When the first subscriber registers for a type, notifies the server so it can
   * start server-driven polling (e.g. system-metrics). When the last subscriber
   * leaves, notifies the server to stop.
   * @param {string} messageType - Type of message to listen for (e.g., 'file-change')
   * @param {function} callback - Function to call when message of this type arrives
   * @returns {function} Unsubscribe function
   */
  const subscribe = useCallback((messageType, callback) => {
    if (!subscribersRef.current.has(messageType)) {
      subscribersRef.current.set(messageType, new Set());
    }
    const subscribers = subscribersRef.current.get(messageType);
    const isFirst = subscribers.size === 0;
    subscribers.add(callback);

    // Notify server when the first local subscriber joins
    if (isFirst) {
      sendToServer({ type: 'subscribe', channel: messageType });
    }

    // Return unsubscribe function
    return () => {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        subscribersRef.current.delete(messageType);
        // Notify server when the last local subscriber leaves
        sendToServer({ type: 'unsubscribe', channel: messageType });
      }
    };
  }, [sendToServer]);

  const value = {
    connected,
    subscribe,
    setShareCredentials,
  };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/**
 * Hook to use the WebSocket connection
 * @returns {object} { connected, subscribe, setShareCredentials }
 */
export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
}
