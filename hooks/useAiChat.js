/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let parsed;
    try { parsed = JSON.parse(text); } catch {}
    const detail = parsed?.error || text.slice(0, 200) || `${res.status} ${res.statusText}`;
    const err = new Error(detail);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}`); }
}

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
    fetchJson(`/api/ai/chat?filePath=${encodeURIComponent(filePath)}`, { signal: ctrl.signal })
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
    fetchJson('/api/ai/usage').then(setUsage).catch((err) => {
      console.warn('[useAiChat] usage fetch failed:', err.message);
    });
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
      await fetchJson('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, requestId, message: text, ...opts }),
      });
    } catch (err) {
      if (err.body?.snapshot) setUsage(err.body.snapshot);
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
