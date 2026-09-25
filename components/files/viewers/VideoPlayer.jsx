/** @format */

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { FiClock, FiAlertTriangle, FiDownload, FiMessageSquare } from 'react-icons/fi';
import { appendFolderPinToUrl } from '@/lib/folderPinStore';
import { useTranslation } from '@/components/LanguageProvider';

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

/**
 * What HEVC this browser can decode through MSE (which hls.js plays into):
 * 0 none, 1 Main (8-bit), 2 Main 10 too. Sent to the server, which copies an
 * HEVC source's stream as-is for a viewer that can play it rather than
 * re-encoding the whole film to H.264. Level 5.1 so 4K sources are covered.
 */
let hevcSupportCache = null;
function getHevcSupport() {
  if (hevcSupportCache !== null) return hevcSupportCache;
  const supports = (codec) => {
    try {
      return !!window.MediaSource?.isTypeSupported?.(`video/mp4; codecs="${codec}"`);
    } catch {
      return false;
    }
  };
  hevcSupportCache = supports('hvc1.2.4.L153.B0') ? 2 : supports('hvc1.1.6.L153.B0') ? 1 : 0;
  return hevcSupportCache;
}

/** Add the HEVC capability to a status/stream URL, when there is one to add. */
function withHevcSupport(url) {
  const level = getHevcSupport();
  return level ? `${url}${url.includes('?') ? '&' : '?'}hevc=${level}` : url;
}

/**
 * Name a subtitle track for the menu. Prefers the embedded title ("English
 * (SDH)"), then the language rendered in the *viewer's* locale — so a French UI
 * shows "Anglais", not "English".
 */
function subtitleLabel(track, uiLang) {
  if (track.title) return track.title;
  if (track.lang) {
    try {
      return new Intl.DisplayNames([uiLang], { type: 'language' }).of(track.lang) || track.lang.toUpperCase();
    } catch {
      return track.lang.toUpperCase();
    }
  }
  return `Track ${track.id + 1}`;
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

/**
 * Subtitle menu. The browser's own CC menu would work, but it is unstyled and
 * looks different in every engine, which sits badly next to the player's own
 * badges — so the <track> elements stay hidden from it and this drives them
 * through the TextTrack API instead.
 */
function SubtitlePicker({ tracks, selected, onSelect, uiLang }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!tracks.length) return null;

  const rowStyle = (active) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--accent)' : 'rgba(255,255,255,0.88)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  });

  return (
    <div ref={rootRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Subtitles"
        aria-label="Subtitles"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: selected >= 0 ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 8,
          padding: '5px 10px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: 'pointer',
          fontFamily: 'inherit',
          backdropFilter: 'blur(6px)',
        }}
      >
        <FiMessageSquare size={12} /> CC
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 168,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'rgba(18,18,20,0.96)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10,
            padding: '5px 0',
            boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)',
            zIndex: 5,
          }}
        >
          <button style={rowStyle(selected < 0)} onClick={() => { onSelect(-1); setOpen(false); }}>
            Off
          </button>
          {tracks.map((track) => (
            <button
              key={track.id}
              style={rowStyle(selected === track.id)}
              onClick={() => { onSelect(track.id); setOpen(false); }}
            >
              {subtitleLabel(track, uiLang)}
              {track.source === 'sidecar' && (
                <span style={{ opacity: 0.5, fontWeight: 500 }}> · file</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Player ─────────────────────────────────────────────── */

export function VideoPlayer({ file, getFileUrl, currentPath, shareToken }) {
  const [status, setStatus] = useState(null); // null | 'pending' | 'transcoding' | 'ready' | 'native' | 'disabled' | 'failed'
  const [progress, setProgress] = useState(0);
  // >0 while this file is waiting on the single encode slot behind another
  // transcode. Distinct from progress: a queued job sits at 0% for as long as
  // the job ahead of it runs, which without this reads as a hung player.
  const [queuePosition, setQueuePosition] = useState(0);
  const [hlsUrl, setHlsUrl] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  // null means "not chosen yet", which resolves to the locale default below.
  // -1 is an explicit Off. Keeping them distinct is what lets the default apply
  // without an effect that would fight the viewer's own choice.
  const [selectedSub, setSelectedSub] = useState(null);
  // While playing, the badge and CC button fade out unless hovered.
  const [playing, setPlaying] = useState(false);
  const pollRef = useRef(null);
  const triggeredRef = useRef(false);
  const mountedRef = useRef(true);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const triggerAbortRef = useRef(null);

  const { lang } = useTranslation();
  const fileExt = getExt(file.name);
  const streamUrl = getFileUrl(file, 'video');

  // The path the folder-lock PIN is keyed on — the file itself, not its folder.
  const targetPath = currentPath ? `${currentPath}/${file.name || file.id}` : file.name || file.id;

  useLayoutEffect(() => {
    setStatus(null);
    setProgress(0);
    setQueuePosition(0);
    setHlsUrl(null);
    setSubtitles([]);
    setSelectedSub(null);
    setPlaying(false);
  }, [file.id]);

  // Discover subtitle tracks. Independent of the transcode state machine: the
  // list comes from the source file, so it is valid whether playback ends up
  // native or HLS, and it costs one ffprobe.
  useEffect(() => {
    if (shareToken) return undefined; // share links don't expose the subtitle API

    const ac = new AbortController();
    const params = new URLSearchParams({ path: currentPath || '' });
    const listUrl = appendFolderPinToUrl(
      `/api/files/subtitles/${encodeURIComponent(file.id)}?${params}`,
      targetPath,
    );

    fetch(listUrl, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (ac.signal.aborted || !data) return;
        setSubtitles((data.tracks || []).filter((t) => t.available));
      })
      .catch(() => {}); // no subtitles is a normal outcome, not an error

    return () => ac.abort();
  }, [file.id, currentPath, shareToken, targetPath]);

  // Until the viewer picks, default to the track matching the UI language —
  // a French UI opens on the French subtitles. Derived rather than stored, so
  // it can't overwrite an explicit choice.
  const effectiveSub = useMemo(
    () => selectedSub ?? (subtitles.find((t) => t.lang === lang)?.id ?? -1),
    [selectedSub, subtitles, lang],
  );

  // Drive the TextTracks. Matching on the element id rather than array position
  // keeps this correct if hls.js ever adds text tracks of its own.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const textTrack of video.textTracks) {
      const id = Number(String(textTrack.id).replace('sub-', ''));
      textTrack.mode = id === effectiveSub ? 'showing' : 'disabled';
    }
  }, [effectiveSub, subtitles, hlsUrl, status]);

  const subtitleTrackEls = useMemo(
    () =>
      subtitles.map((track) => (
        <track
          key={track.id}
          id={`sub-${track.id}`}
          kind="subtitles"
          label={subtitleLabel(track, lang)}
          srcLang={track.lang || undefined}
          src={appendFolderPinToUrl(
            `/api/files/subtitles/${encodeURIComponent(file.id)}?${new URLSearchParams({
              path: currentPath || '',
              track: String(track.id),
            })}`,
            targetPath,
          )}
        />
      )),
    [subtitles, lang, file.id, currentPath, targetPath],
  );

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
      // Fetch the first segment while the playlist is still being parsed,
      // rather than after — one round trip off the time to first frame.
      startFragPrefetch: true,
      // Buffer a minute ahead instead of the default 30 s, so a slow patch on
      // the network (or the encoder catching up after a seek) is absorbed
      // without a stall.
      maxBufferLength: 60,
      // Playback now starts before ffmpeg has written the first segment, and the
      // HLS route holds a segment request up to 30 s until it exists. hls.js's
      // default 10 s time-to-first-byte would abort and refetch mid-wait, so
      // match the server. Rest is the hls.js default — this policy is replaced
      // whole, not merged.
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 30000,
          maxLoadTimeMs: 120000,
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
          errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      },
    });

    // Without this the player fails silently: a stalled or undecodable segment
    // shows up only as the same .ts being refetched forever in the network tab,
    // with nothing naming the cause. `details` is the useful field — e.g.
    // bufferAppendError, fragParsingError, levelLoadTimeOut.
    let recoveries = 0;
    let repeatedFragErrors = 0;
    let lastErrorSn = -1;

    // Tearing down has to be idempotent: giving up inside the ERROR handler and
    // the effect cleanup can both run, and destroying hls.js twice throws.
    let destroyed = false;
    const teardown = () => {
      if (destroyed) return;
      destroyed = true;
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };

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
          // Clearing hlsUrl unmounts the <video>, which is what lets the failure
          // card render — the hlsUrl branch returns the player before any status
          // is consulted, so without this the user just gets a dead black frame.
          teardown();
          if (mountedRef.current) {
            setHlsUrl(null);
            setStatus('failed');
          }
        }
        return;
      }

      // Cap recovery attempts. hls.startLoad()/recoverMediaError() re-enter the
      // same failing fragment, so an unbounded handler turns one bad segment
      // into the request storm it was meant to fix.
      if (recoveries >= 3) {
        console.error('[hls] giving up after 3 recovery attempts', { details });
        teardown();
        if (mountedRef.current) {
          setHlsUrl(null);
          setStatus('failed');
        }
        return;
      }
      recoveries++;

      if (type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        teardown();
        if (mountedRef.current) {
          setHlsUrl(null);
          setStatus('failed');
        }
      }
    });

    hls.loadSource(hlsUrl);
    hls.attachMedia(videoRef.current);
    hlsRef.current = hls;

    return teardown;
  }, [hlsUrl]);

  const checkStatus = useCallback(
    async (signal) => {
      try {
        const params = new URLSearchParams({ path: currentPath || '' });
        // Native fetch doesn't go through the axios interceptor, so the
        // folder PIN (if any) needs to be appended manually. The server
        // returns a bare hlsUrl too — re-append the PIN before handing it
        // to hls.js, otherwise the manifest fetch will 423.
        const statusUrl = appendFolderPinToUrl(
          withHevcSupport(`/api/files/transcode-status/${encodeURIComponent(file.id)}?${params}`),
          targetPath,
        );
        const res = await fetch(statusUrl, { signal });
        if (!res.ok) return null;
        const data = await res.json();
        if (!mountedRef.current) return null;
        setStatus(data.status);
        if (data.progress !== undefined) setProgress(data.progress);
        setQueuePosition(data.queuePosition ?? 0);
        if (data.hlsUrl) setHlsUrl(appendFolderPinToUrl(data.hlsUrl, targetPath));
        return data.status;
      } catch (err) {
        if (err.name === 'AbortError') return null;
        return null;
      }
    },
    [file.id, currentPath, targetPath],
  );

  const triggerTranscode = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    const ac = new AbortController();
    triggerAbortRef.current = ac;
    // Must carry the same HEVC capability as the status poll: the two have to
    // agree on which rendition this viewer gets.
    fetch(withHevcSupport(streamUrl), { signal: ac.signal }).catch(() => {});
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
    // Start fast and back off. The server can hand out a playable hlsUrl within
    // a second of the trigger, and a flat 3 s interval was most of the wait
    // before the first frame; once playing, polls only move the progress pill.
    let pollDelay = 500;

    const poll = async () => {
      const s = await checkStatus(ac.signal);
      if (ac.signal.aborted) return;
      if (s === 'pending' || s === 'transcoding') {
        triggerTranscode();
        pollRef.current = setTimeout(poll, pollDelay);
        pollDelay = Math.min(pollDelay * 2, 3000);
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
  const onSelectSub = (id) => setSelectedSub(id);
  const onRetry = () => {
    setStatus(null);
    setProgress(0);
    setQueuePosition(0);
    setHlsUrl(null);
    triggeredRef.current = false;
    checkStatus();
  };

  // One player for every playable state; only the source, badge and the
  // transcoding overlay differ. hls.js attaches itself, so HLS has no src.
  const renderPlayer = ({ src, badge = null, overlay = null }) => (
    <div className={`mv-video${playing ? ' mv-video--playing' : ''}`}>
      <video
        key={file.id}
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="mv-video__el"
        onClick={(e) => e.stopPropagation()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        {subtitleTrackEls}
      </video>
      {overlay}
      <div className="mv-video__chrome">
        <SubtitlePicker tracks={subtitles} selected={effectiveSub} onSelect={onSelectSub} uiLang={lang} />
        {badge}
      </div>
    </div>
  );

  if (status === null) return <StateInitial />;

  if (hlsUrl) {
    return renderPlayer({
      badge: <div className="mv-video-badge mv-video-badge--hls">HLS</div>,
      overlay: status === 'transcoding' && progress < 99 && (
        <div className="mv-video-transcoding-pill">
          <div className="mv-spinner mv-spinner--glass" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>
            {queuePosition > 0 ? `Queued · ${queuePosition} ahead` : `Transcoding… ${progress}%`}
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
      ),
    });
  }

  if (status === 'native' || status === 'ready') {
    return renderPlayer({ src: streamUrl, badge: <div className="mv-video-badge mv-video-badge--mp4">MP4</div> });
  }

  if (status === 'transcoding') {
    // Queued jobs have not reached the encoder, so their 0% is not progress —
    // say so rather than showing a bar that cannot move yet.
    const queued = queuePosition > 0;
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="mv-video-state-card"
          style={{ padding: '28px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 340 }}
        >
          <div className="mv-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {queued ? 'Waiting for the encoder…' : 'Transcoding video for playback…'}
          </div>
          {!queued && (
            <div style={{ width: '100%' }}>
              <div className="mv-progress">
                <div className="mv-progress__fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
            {queued
              ? `${queuePosition} ${queuePosition === 1 ? 'video is' : 'videos are'} ahead of this one`
              : `${progress}% — playback will start soon`}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'pending') return <StatePending />;
  if (status === 'disabled') return <StateDisabled onDownload={onDownload} />;
  if (status === 'failed') return <StateFailed onDownload={onDownload} onRetry={onRetry} />;

  return renderPlayer({ src: streamUrl });
}
