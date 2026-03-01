/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// Native browser-playable extensions — no status check needed
const NATIVE_EXTS = new Set(['.mp4', '.webm', '.ogv', '.ogg']);

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function VideoPlayer({ file, getFileUrl, currentPath, shareToken }) {
  const [status, setStatus] = useState(null); // null = initial load
  const [progress, setProgress] = useState(0);
  const [hlsUrl, setHlsUrl] = useState(null);
  const pollRef = useRef(null);
  const triggeredRef = useRef(false);
  const mountedRef = useRef(true);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  // Abort controller for the fire-and-forget transcode trigger fetch.
  // Stored in a ref so we can abort it when the component unmounts (e.g. rapid scroll).
  const triggerAbortRef = useRef(null);

  const fileExt = getExt(file.name);
  const streamUrl = getFileUrl(file, 'video');

  // ─── hls.js lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!hlsUrl || !videoRef.current) return;

    // Safari / iOS have native HLS support — use it directly
    if (!Hls.isSupported()) {
      videoRef.current.src = hlsUrl;
      return;
    }

    // Destroy any existing instance before creating a new one
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const hls = new Hls({
      // Allow hls.js to start loading the manifest even during live transcode
      liveSyncDurationCount: 3,
      // Tolerate manifest parse errors gracefully (playlist still growing)
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 1000,
    });

    hls.loadSource(hlsUrl);
    hls.attachMedia(videoRef.current);
    hlsRef.current = hls;

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl]);

  // ─── Status polling ───────────────────────────────────────────────────────
  const checkStatus = useCallback(async (signal) => {
    try {
      const params = new URLSearchParams({ path: currentPath || '' });
      const res = await fetch(
        `/api/files/transcode-status/${encodeURIComponent(file.id)}?${params}`,
        { signal }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!mountedRef.current) return null;
      setStatus(data.status);
      if (data.progress !== undefined) setProgress(data.progress);
      if (data.hlsUrl) setHlsUrl(data.hlsUrl);
      return data.status;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      return null;
    }
  }, [file.id, currentPath]);

  // Fire-and-forget the stream route to kick off the HLS transcode job.
  // Uses an AbortController stored in triggerAbortRef so it can be cancelled
  // on unmount — preventing orphaned ffprobe/ffmpeg processes on the server.
  const triggerTranscode = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    const ac = new AbortController();
    triggerAbortRef.current = ac;
    fetch(streamUrl, { signal: ac.signal }).catch(() => {});
  }, [streamUrl]);

  useEffect(() => {
    mountedRef.current = true;
    triggeredRef.current = false;

    // Reset state for the new file immediately so stale status from a previous
    // file (including any error state) never bleeds into the next one.
    setStatus(null);
    setProgress(0);
    setHlsUrl(null);

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

    // Single AbortController covers both status-check fetches and the poll loop.
    const ac = new AbortController();
    let debounceTimer = null;

    const poll = async () => {
      const s = await checkStatus(ac.signal);
      if (ac.signal.aborted) return;

      if (s === 'pending') {
        triggerTranscode();
        pollRef.current = setTimeout(poll, 3000);
      } else if (s === 'transcoding') {
        // Continue polling even when hlsUrl is set — we want to update progress
        // and catch the transition to 'ready'
        pollRef.current = setTimeout(poll, 3000);
      } else if (s === null) {
        // Network failure (e.g. server temporarily overloaded) — retry after a
        // longer delay rather than leaving the user stuck on a spinner forever.
        pollRef.current = setTimeout(poll, 5000);
      }
      // ready / native / disabled → stop polling
    };

    // Debounce: wait 400ms before starting work on this file.
    // When the user scrolls rapidly, they navigate away before the timer fires,
    // so no status check or transcode trigger is ever sent to the server.
    // This prevents a flood of ffprobe/ffmpeg subprocess spawns that exhaust
    // the OS file-descriptor limit and produce ECONNREFUSED errors.
    debounceTimer = setTimeout(() => {
      if (!ac.signal.aborted) {
        poll();
      }
    }, 400);

    return () => {
      ac.abort(); // cancels in-flight status-check fetches
      mountedRef.current = false;
      clearTimeout(pollRef.current);
      clearTimeout(debounceTimer);
      // Cancel the trigger fetch so the server can stop the expensive probing
      if (triggerAbortRef.current) {
        triggerAbortRef.current.abort();
        triggerAbortRef.current = null;
      }
    };
  }, [file.id, fileExt, shareToken, checkStatus, triggerTranscode]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Initial loading state
  if (status === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        <p className="text-sm">Checking video…</p>
      </div>
    );
  }

  // HLS early playback or complete — show video with optional progress overlay
  if (hlsUrl) {
    return (
      <div className="relative w-full h-full">
        <video
          key={file.id}
          ref={videoRef}
          controls
          className="w-full h-full"
          onClick={(e) => e.stopPropagation()}
        />
        {status === 'transcoding' && (
          <div className="absolute bottom-12 left-0 right-0 px-4 pointer-events-none">
            <div className="bg-black/70 rounded-lg px-3 py-2 flex flex-col gap-1">
              <p className="text-xs text-gray-300">
                Transcoding… {progress}% — more of the video will become available shortly
              </p>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Ready to play (MP4 cache path — no HLS)
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

  // Transcoding in progress, waiting for first 2 segments
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
        <p className="text-xs text-gray-500">{progress}% — playback will start soon</p>
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
