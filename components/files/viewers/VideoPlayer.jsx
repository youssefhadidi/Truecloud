/** @format */

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { FiClock, FiAlertTriangle, FiDownload } from 'react-icons/fi';
import { appendFolderPinToUrl } from '@/lib/folderPinStore';

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

/* ─── Visual atoms (token-aware) ────────────────────────── */

function StateInitial() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-video-state-card" style={{ padding: '24px 32px', display: 'flex', alignItems: 'center', gap: 16, minWidth: 320 }}>
        <div className="mv-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Initialising player…</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Checking format compatibility</div>
        </div>
      </div>
    </div>
  );
}

function StatePending() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="mv-video-state-card"
        style={{ padding: '28px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 320 }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            background: 'var(--accent-light)',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FiClock size={24} color="var(--accent)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Queued for transcoding</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>Your video will be processed shortly</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="mv-video-pending-dot" />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)', letterSpacing: '0.04em' }}>PENDING</span>
        </div>
      </div>
    </div>
  );
}

function StateDisabled({ onDownload }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="mv-video-state-card"
        style={{
          padding: '28px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          maxWidth: 380,
          background: 'var(--warning-light)',
          borderColor: 'var(--warning)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            background: 'rgba(245,158,11,0.18)',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FiAlertTriangle size={24} color="var(--warning)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Playback disabled</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            Video transcoding is disabled on this server. Download the file to play locally.
          </div>
        </div>
        <button
          onClick={onDownload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--warning)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <FiDownload size={14} /> Download file
        </button>
      </div>
    </div>
  );
}

function StateFailed({ onDownload, onRetry }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="mv-video-state-card"
        style={{
          padding: '28px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          maxWidth: 380,
          background: 'var(--danger-light)',
          borderColor: 'var(--danger)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            background: 'rgba(239,68,68,0.18)',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FiAlertTriangle size={24} color="var(--danger)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Transcoding failed</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            An error occurred while processing this video. Please try re-uploading or check server logs.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onRetry}
            style={{
              background: 'var(--surface)',
              color: 'var(--danger)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Retry
          </button>
          <button
            onClick={onDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--danger)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <FiDownload size={13} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Player ─────────────────────────────────────────────── */

export function VideoPlayer({ file, getFileUrl, currentPath, shareToken }) {
  const [status, setStatus] = useState(null); // null | 'pending' | 'transcoding' | 'ready' | 'native' | 'disabled' | 'failed'
  const [progress, setProgress] = useState(0);
  const [hlsUrl, setHlsUrl] = useState(null);
  const pollRef = useRef(null);
  const triggeredRef = useRef(false);
  const mountedRef = useRef(true);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const triggerAbortRef = useRef(null);

  const fileExt = getExt(file.name);
  const streamUrl = getFileUrl(file, 'video');

  useLayoutEffect(() => {
    setStatus(null);
    setProgress(0);
    setHlsUrl(null);
  }, [file.id]);

  useEffect(() => {
    if (!hlsUrl || !videoRef.current) return undefined;

    if (!Hls.isSupported()) {
      videoRef.current.src = hlsUrl;
      return undefined;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const hls = new Hls({
      liveSyncDurationCount: 3,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 1000,
    });

    // Without this the player fails silently: a stalled or undecodable segment
    // shows up only as the same .ts being refetched forever in the network tab,
    // with nothing naming the cause. `details` is the useful field — e.g.
    // bufferAppendError, fragParsingError, levelLoadTimeOut.
    let recoveries = 0;
    let repeatedFragErrors = 0;
    let lastErrorSn = -1;

    hls.on(Hls.Events.ERROR, (_event, data) => {
      const { type, details, fatal, frag, sourceBufferName } = data;
      // Error/DOMException properties are non-enumerable, so `data.error` prints
      // as `{}` when the event object is logged or serialised — the one field
      // that says *why* an append was rejected. Pull it out by hand.
      const cause = data.error ? `${data.error.name}: ${data.error.message}` : '';
      console[fatal ? 'error' : 'warn'](
        `[hls] ${fatal ? 'fatal' : 'non-fatal'} ${type}: ${details}` +
          (sourceBufferName ? ` [${sourceBufferName}]` : '') +
          (frag ? ` sn=${frag.sn}` : '') +
          (cause ? ` — ${cause}` : ''),
        data,
      );

      if (!fatal) {
        // hls.js retries non-fatal errors itself, with no cap when the retry
        // keeps failing the same way. A segment the browser cannot decode
        // therefore loops forever, and that loop — not the server — is what
        // floods the network tab with identical requests. Break it.
        const sn = frag?.sn ?? -1;
        repeatedFragErrors = sn === lastErrorSn ? repeatedFragErrors + 1 : 1;
        lastErrorSn = sn;
        if (repeatedFragErrors >= 5) {
          console.error(`[hls] segment ${sn} failed ${repeatedFragErrors}x (${details}) — stopping retry loop`);
          hls.destroy();
          hlsRef.current = null;
        }
        return;
      }

      // Cap recovery attempts. hls.startLoad()/recoverMediaError() re-enter the
      // same failing fragment, so an unbounded handler turns one bad segment
      // into the request storm it was meant to fix.
      if (recoveries >= 3) {
        console.error('[hls] giving up after 3 recovery attempts', { details });
        hls.destroy();
        hlsRef.current = null;
        return;
      }
      recoveries++;

      if (type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        hls.destroy();
        hlsRef.current = null;
      }
    });

    hls.loadSource(hlsUrl);
    hls.attachMedia(videoRef.current);
    hlsRef.current = hls;

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl]);

  const checkStatus = useCallback(
    async (signal) => {
      try {
        const params = new URLSearchParams({ path: currentPath || '' });
        // Native fetch doesn't go through the axios interceptor, so the
        // folder PIN (if any) needs to be appended manually. The server
        // returns a bare hlsUrl too — re-append the PIN before handing it
        // to hls.js, otherwise the manifest fetch will 423.
        const targetPath = currentPath ? `${currentPath}/${file.name || file.id}` : (file.name || file.id);
        const statusUrl = appendFolderPinToUrl(
          `/api/files/transcode-status/${encodeURIComponent(file.id)}?${params}`,
          targetPath,
        );
        const res = await fetch(statusUrl, { signal });
        if (!res.ok) return null;
        const data = await res.json();
        if (!mountedRef.current) return null;
        setStatus(data.status);
        if (data.progress !== undefined) setProgress(data.progress);
        if (data.hlsUrl) setHlsUrl(appendFolderPinToUrl(data.hlsUrl, targetPath));
        return data.status;
      } catch (err) {
        if (err.name === 'AbortError') return null;
        return null;
      }
    },
    [file.id, file.name, currentPath],
  );

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

    if (shareToken) {
      setStatus('native');
      return undefined;
    }

    const ac = new AbortController();
    let debounceTimer = null;

    const poll = async () => {
      const s = await checkStatus(ac.signal);
      if (ac.signal.aborted) return;
      if (s === 'pending') {
        triggerTranscode();
        pollRef.current = setTimeout(poll, 3000);
      } else if (s === 'transcoding') {
        triggerTranscode();
        pollRef.current = setTimeout(poll, 3000);
      } else if (s === null) {
        pollRef.current = setTimeout(poll, 5000);
      }
    };

    debounceTimer = setTimeout(() => {
      if (!ac.signal.aborted) poll();
    }, 400);

    return () => {
      ac.abort();
      mountedRef.current = false;
      clearTimeout(pollRef.current);
      clearTimeout(debounceTimer);
      if (triggerAbortRef.current) {
        triggerAbortRef.current.abort();
        triggerAbortRef.current = null;
      }
    };
  }, [file.id, fileExt, shareToken, checkStatus, triggerTranscode]);

  const onDownload = () => {
    const url = getFileUrl(file, 'download');
    window.open(url, '_blank');
  };
  const onRetry = () => {
    setStatus(null);
    setProgress(0);
    setHlsUrl(null);
    triggeredRef.current = false;
    checkStatus();
  };

  if (status === null) return <StateInitial />;

  if (hlsUrl) {
    return (
      <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', flexDirection: 'column' }}>
        <video
          key={file.id}
          ref={videoRef}
          controls
          playsInline
          style={{ width: '100%',height: '100%', flex: 1, objectFit: 'contain' }}
          onClick={(e) => e.stopPropagation()}
        />
        {status === 'transcoding' && progress < 99 && (
          <div className="mv-video-transcoding-pill">
            <div className="mv-spinner mv-spinner--glass" style={{ width: 14, height: 14, borderWidth: 2 }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>
              Transcoding… {progress}%
            </span>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.15)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'var(--accent)',
                  borderRadius: 999,
                  transition: 'width 400ms ease',
                }}
              />
            </div>
          </div>
        )}
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <div className="mv-video-badge mv-video-badge--hls">HLS</div>
        </div>
      </div>
    );
  }

  if (status === 'native' || status === 'ready') {
    return (
      <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', flexDirection: 'column' }}>
        <video
          key={file.id}
          src={streamUrl}
          controls
          playsInline
          style={{ width: '100%',height: '100%', flex: 1, objectFit: 'contain' }}
          onClick={(e) => e.stopPropagation()}
        />
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <div className="mv-video-badge mv-video-badge--mp4">MP4</div>
        </div>
      </div>
    );
  }

  if (status === 'transcoding') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="mv-video-state-card"
          style={{ padding: '28px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 340 }}
        >
          <div className="mv-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Transcoding video for playback…</div>
          <div style={{ width: '100%' }}>
            <div className="mv-progress">
              <div className="mv-progress__fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{progress}% — playback will start soon</div>
        </div>
      </div>
    );
  }

  if (status === 'pending') return <StatePending />;
  if (status === 'disabled') return <StateDisabled onDownload={onDownload} />;
  if (status === 'failed') return <StateFailed onDownload={onDownload} onRetry={onRetry} />;

  return (
    <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', flexDirection: 'column' }}>
      <video
        key={file.id}
        src={streamUrl}
        controls
        playsInline
        style={{ width: '100%', height: '100%', flex: 1, objectFit: 'contain' }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
