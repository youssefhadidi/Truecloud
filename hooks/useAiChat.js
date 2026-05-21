/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

export function useAiChat(filePath) {
  const { subscribe } = useWebSocket();
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [usage, setUsage] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState(null);
  const activeRequestIdRef = useRef(null);

  useEffect(() => {
    if (!filePath) return;
    setLoadingHistory(true);
    setError(null);
    setMessages([]);
    setStreamingText('');
    setStreaming(false);
    activeRequestIdRef.current = null;

    const ctrl = new AbortController();
    fetch(`/api/ai/chat?filePath=${encodeURIComponent(filePath)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.messages)) setMessages(data.messages);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err?.message || 'Failed to load history');
      })
      .finally(() => setLoadingHistory(false));

    return () => ctrl.abort();
  }, [filePath]);

  const refreshUsage = useCallback(() => {
    fetch('/api/ai/usage').then((r) => r.json()).then(setUsage).catch(() => {});
  }, []);

  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  useEffect(() => {
    const unsubChunk = subscribe('ai-chunk', (msg) => {
      if (msg.payload?.requestId !== activeRequestIdRef.current) return;
      setStreamingText((prev) => prev + (msg.payload.delta || ''));
    });
    const unsubDone = subscribe('ai-done', (msg) => {
      if (msg.payload?.requestId !== activeRequestIdRef.current) return;
      setStreamingText((finalText) => {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.payload.messageId,
            role: 'assistant',
            content: finalText,
            costUsd: msg.payload.costUsd,
            createdAt: new Date().toISOString(),
          },
        ]);
        return '';
      });
      setStreaming(false);
      activeRequestIdRef.current = null;
      if (msg.payload.snapshot) setUsage(msg.payload.snapshot);
    });
    const unsubError = subscribe('ai-error', (msg) => {
      if (msg.payload?.requestId !== activeRequestIdRef.current) return;
      setError(msg.payload.message || 'Stream failed');
      setStreaming(false);
      setStreamingText('');
      activeRequestIdRef.current = null;
    });
    return () => { unsubChunk(); unsubDone(); unsubError(); };
  }, [subscribe]);

  const send = useCallback(async (text, opts = {}) => {
    if (!filePath || !text.trim() || streaming) return;
    setError(null);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    activeRequestIdRef.current = requestId;
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${requestId}`, role: 'user', content: text, createdAt: new Date().toISOString() },
    ]);
    setStreamingText('');
    setStreaming(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, requestId, message: text, ...opts }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Request failed (${res.status})`);
        setStreaming(false);
        activeRequestIdRef.current = null;
        if (body.snapshot) setUsage(body.snapshot);
      }
    } catch (err) {
      setError(err?.message || 'Network error');
      setStreaming(false);
      activeRequestIdRef.current = null;
    }
  }, [filePath, streaming]);

  const clear = useCallback(async () => {
    if (!filePath) return;
    setMessages([]);
    setStreamingText('');
    setError(null);
    try {
      await fetch(`/api/ai/chat?filePath=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
    } catch {}
  }, [filePath]);

  return {
    messages,
    streaming,
    streamingText,
    usage,
    loadingHistory,
    error,
    send,
    clear,
    refreshUsage,
  };
}
