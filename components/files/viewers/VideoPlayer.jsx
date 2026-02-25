/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Native browser-playable extensions — no status check needed
const NATIVE_EXTS = new Set(['.mp4', '.webm', '.ogv', '.ogg']);

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function VideoPlayer({ file, getFileUrl, currentPath, shareToken }) {
  const [status, setStatus] = useState(null); // null = initial load
  const [progress, setProgress] = useState(0);
  const pollRef = useRef(null);
  const triggeredRef = useRef(false);
  const mountedRef = useRef(true);

  const fileExt = getExt(file.name);
  const streamUrl = getFileUrl(file, 'video');

  const checkStatus = useCallback(async () => {
    try {
      const params = new URLSearchParams({ path: currentPath || '' });
      const res = await fetch(`/api/files/transcode-status/${encodeURIComponent(file.id)}?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!mountedRef.current) return null;
      setStatus(data.status);
      if (data.progress !== undefined) setProgress(data.progress);
      return data.status;
    } catch {
      return null;
    }
  }, [file.id, currentPath]);

  // Fire-and-forget the stream route to kick off the transcode job
  const triggerTranscode = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    fetch(streamUrl).catch(() => {});
  }, [streamUrl]);

  useEffect(() => {
    mountedRef.current = true;
    triggeredRef.current = false;

    // Share links bypass auth — serve directly without status check
    if (shareToken) {
      setStatus('native');
      return;
    }

    // Native formats — no processing needed
    if (NATIVE_EXTS.has(fileExt)) {
      setStatus('native');
      return;
    }

    let cancelled = false;

    const poll = async () => {
      const s = await checkStatus();
      if (cancelled) return;

      if (s === 'pending') {
        triggerTranscode();
        pollRef.current = setTimeout(poll, 3000);
      } else if (s === 'transcoding') {
        pollRef.current = setTimeout(poll, 3000);
      }
      // ready / native / disabled / error → stop polling
    };

    poll();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimeout(pollRef.current);
    };
  }, [file.id, fileExt, shareToken, checkStatus, triggerTranscode]);

  // Initial loading state
  if (status === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        <p className="text-sm">Checking video…</p>
      </div>
    );
  }

  // Ready to play
  if (status === 'native' || status === 'ready') {
    return (
      <video
        key={file.id}
        src={streamUrl}
        controls
        className="w-full h-full"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  // Transcoding in progress
  if (status === 'transcoding') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-gray-300 max-w-sm w-full">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" />
        <p className="text-sm font-medium">Transcoding video for playback…</p>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">{progress}% complete</p>
      </div>
    );
  }

  // Queued, not yet started
  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        <p className="text-sm">Preparing video for playback…</p>
      </div>
    );
  }

  // Transcoding disabled or failed — attempt native play with a notice
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <video
        key={file.id}
        src={streamUrl}
        controls
        className="w-full h-full"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-yellow-400 bg-black/60 px-3 py-1 rounded-full pointer-events-none">
        {status === 'disabled'
          ? 'Transcoding disabled — playback may fail. Enable it in Admin → Components.'
          : 'Transcode failed — attempting native playback.'}
      </p>
    </div>
  );
}
