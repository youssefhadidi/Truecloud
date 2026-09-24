/** @format */

'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiZoomIn, FiZoomOut, FiAlertTriangle, FiExternalLink, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import './pdf-viewer.css';

// pdf.js fetches its worker, wasm image decoders (JBIG2 / JPEG 2000 — most
// scanned PDFs), CMaps and standard fonts at runtime; app/api/pdfjs serves
// them from the installed package so they always match the bundled version.
const ASSET_BASE = '/api/pdfjs/';

const PAD = 12; // px around the page column
const GAP = 10; // px between pages
const MIN_SCALE = 0.25; // CSS px per PDF point
const MAX_SCALE = 8;
// "Fit width" never blows a page up past this — on a wide desktop screen a
// portrait page at full width is taller than anyone wants to scroll.
const MAX_AUTO_SCALE = 1.5;
const ZOOM_STEP = 1.25;
// Per-page canvas budget. iOS caps total canvas memory (a few hundred MB) and
// kills the tab past it; at high zoom the page is rendered at a lower
// device-pixel ratio instead, slightly soft rather than crashing.
const MAX_CANVAS_PIXELS = 1 << 23;
// Below this, let pdf.js stream the whole file (fewest round trips). Above
// it, only fetch the byte ranges the visible pages need — a 200 MB scan opens
// as fast as a 2 MB one and mobile data isn't spent on pages never viewed.
const LAZY_LOAD_BYTES = 8 * 1024 * 1024;
// Re-rendering at the new zoom waits for the gesture to settle; the old
// bitmap is CSS-stretched in the meantime.
const RERENDER_DELAY_MS = 150;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The legacy build, not the modern one: the modern build calls APIs like
// Math.sumPrecise natively, which only the newest browsers ship — older
// phones would fail to open any PDF. The legacy build polyfills them.
let pdfjsPromise = null;
let sharedWorker = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.min.mjs')
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}legacy/build/pdf.worker.min.mjs`;
      return lib;
    })
    .catch((err) => {
      pdfjsPromise = null; // let the next open retry instead of caching the failure
      throw err;
    });
  return pdfjsPromise;
}

// One worker for every document: spinning one up parses ~1.3 MB of JS, which
// is most of the open time for a small PDF. Destroying a document doesn't
// terminate a worker it was handed.
function getSharedWorker(lib) {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new lib.PDFWorker({ name: 'pdfjs' });
  return sharedWorker;
}

/** Index of the last page whose top is <= y (tops ascending). */
function pageAt(tops, y) {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const PdfPage = memo(function PdfPage({ doc, pageNumber, top, left, width, height, scale, onSize }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const renderedScaleRef = useRef(0);

  useEffect(() => {
    if (renderedScaleRef.current === scale) return undefined;
    let cancelled = false;
    let renderTask = null;

    const timer = setTimeout(async () => {
      let canvas = null;
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        onSize(pageNumber, base.width, base.height);

        const viewport = page.getViewport({ scale });
        const cssPixels = viewport.width * viewport.height;
        let outputScale = window.devicePixelRatio || 1;
        if (cssPixels * outputScale * outputScale > MAX_CANVAS_PIXELS) {
          outputScale = Math.sqrt(MAX_CANVAS_PIXELS / cssPixels);
        }

        // Render off-DOM and swap in when done, so the previous bitmap stays
        // visible (stretched) instead of flashing blank on every zoom.
        canvas = document.createElement('canvas');
        canvas.className = 'pdfv-canvas';
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
        if (cancelled || !holderRef.current) throw new Error('stale');

        const old = canvasRef.current;
        holderRef.current.appendChild(canvas);
        if (old) {
          old.remove();
          old.width = 0; // release the bitmap now rather than at GC
          old.height = 0;
        }
        canvasRef.current = canvas;
        renderedScaleRef.current = scale;
      } catch (err) {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        if (!cancelled && err?.name !== 'RenderingCancelledException' && err?.message !== 'stale') {
          console.warn(`PDF page ${pageNumber} failed to render`, err);
        }
      }
    }, renderedScaleRef.current ? RERENDER_DELAY_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, onSize]);

  // Pages are unmounted once scrolled well out of view; free their bitmaps
  // immediately so a long document doesn't accumulate canvas memory.
  useEffect(
    () => () => {
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    },
    [],
  );

  return <div ref={holderRef} className="pdfv-page" style={{ top, left, width, height }} />;
});

export default function PdfViewer({ url, fileSize, onClick }) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const contentRef = useRef(null);

  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState({ state: 'loading', progress: 0 });
  // Page sizes in PDF points. Every page is assumed to match page 1 until it
  // is actually fetched — fetching all of them up front would defeat lazy
  // loading on a large document.
  const [defaultSize, setDefaultSize] = useState(null);
  const [pageSizes, setPageSizes] = useState({});
  const [scale, setScale] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // Follow the container width (rotation, AI panel, fullscreen) until the
  // user picks a zoom themselves.
  const fitRef = useRef(true);
  // Point to hold still across a zoom: {page, fx, fy, vx, vy} = page-relative
  // fractions and the viewport position they should land on.
  const anchorRef = useRef(null);
  const scaleRef = useRef(null);
  const layoutRef = useRef(null);
  const lastTouchRef = useRef(0);
  // Read from the password prompt without making a language switch reload
  // the document.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);

  // ── Load ────────────────────────────────────────────────────────────────
  // The caller keys this component by file, so each document starts from
  // fresh state and this effect never has to reset any.
  useEffect(() => {
    let cancelled = false;
    let task = null;

    loadPdfjs()
      .then(async (lib) => {
        if (cancelled) return;
        const lazy = !(fileSize > 0) || fileSize > LAZY_LOAD_BYTES;
        task = lib.getDocument({
          url,
          worker: getSharedWorker(lib),
          rangeChunkSize: 256 * 1024,
          // Both are needed for fetch-on-demand; with streaming left on,
          // pdf.js keeps downloading the whole file in the background.
          disableAutoFetch: lazy,
          disableStream: lazy,
          cMapUrl: `${ASSET_BASE}cmaps/`,
          standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
          wasmUrl: `${ASSET_BASE}wasm/`,
          iccUrl: `${ASSET_BASE}iccs/`,
          isEvalSupported: false,
        });
        if (!lazy) {
          task.onProgress = ({ loaded, total }) => {
            if (!cancelled && total) setStatus((s) => (s.state === 'loading' ? { state: 'loading', progress: loaded / total } : s));
          };
        }
        task.onPassword = (updatePassword, reason) => {
          const retry = reason === lib.PasswordResponses.INCORRECT_PASSWORD;
          const password = window.prompt(tRef.current(retry ? 'viewer.pdfPasswordRetry' : 'viewer.pdfPasswordPrompt'));
          if (password === null) {
            if (!cancelled) setStatus({ state: 'error', reason: 'password' });
            task.destroy();
            return;
          }
          updatePassword(password);
        };

        const pdf = await task.promise;
        const first = await pdf.getPage(1);
        if (cancelled) return;
        const base = first.getViewport({ scale: 1 });
        setDefaultSize({ width: base.width, height: base.height });
        setPageSizes({ 1: { width: base.width, height: base.height } });
        setDoc(pdf);
        setStatus({ state: 'ready' });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus((s) => (s.state === 'error' ? s : { state: 'error', reason: err?.name === 'PasswordException' ? 'password' : 'load' }));
      });

    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [url, fileSize]);

  // ── Viewport tracking ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const ro = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only the vertical position drives rendering; horizontal panning doesn't
  // need a re-render.
  const onScroll = useCallback(() => setScrollTop(scrollRef.current.scrollTop), []);

  const autoScale =
    defaultSize && viewport.width ? clamp((viewport.width - PAD * 2) / defaultSize.width, MIN_SCALE, MAX_AUTO_SCALE) : null;

  /** Change scale keeping the page at the top edge of the view in place. */
  const setScaleKeepingTop = useCallback((target) => {
    const el = scrollRef.current;
    const cur = layoutRef.current;
    if (target === scaleRef.current) return;
    if (cur) {
      const page = pageAt(cur.tops, el.scrollTop);
      const fy = (el.scrollTop - cur.tops[page]) / cur.sizes[page].h;
      anchorRef.current = { scale: target, page, fx: 0.5, fy, vx: el.clientWidth / 2, vy: 0 };
    }
    setScale(target);
  }, []);

  useEffect(() => {
    if (autoScale && fitRef.current) setScaleKeepingTop(autoScale);
  }, [autoScale, setScaleKeepingTop]);

  const onSize = useCallback((pageNumber, width, height) => {
    setPageSizes((prev) => {
      const cur = prev[pageNumber];
      if (cur && cur.width === width && cur.height === height) return prev;
      return { ...prev, [pageNumber]: { width, height } };
    });
  }, []);

  // ── Layout ──────────────────────────────────────────────────────────────
  const numPages = doc?.numPages ?? 0;
  const layout = useMemo(() => {
    if (!doc || !scale || !defaultSize) return null;
    const tops = new Float64Array(numPages);
    const sizes = new Array(numPages);
    let y = PAD;
    let maxWidth = 0;
    for (let i = 0; i < numPages; i++) {
      const s = pageSizes[i + 1] || defaultSize;
      const w = s.width * scale;
      const h = s.height * scale;
      tops[i] = y;
      sizes[i] = { w, h };
      y += h + GAP;
      if (w > maxWidth) maxWidth = w;
    }
    const width = Math.max(viewport.width, maxWidth + PAD * 2);
    return { tops, sizes, width, height: y - GAP + PAD };
  }, [doc, numPages, scale, defaultSize, pageSizes, viewport.width]);

  // Handlers (native listeners, zoomTo) read the committed scale/layout
  // through refs. Declared before the anchor restore so it sees them fresh.
  useLayoutEffect(() => {
    scaleRef.current = scale;
    layoutRef.current = layout;
  }, [scale, layout]);

  // Restore the zoom anchor once the new layout is in the DOM.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = scrollRef.current;
    if (!a || !layout || scale !== a.scale) return;
    anchorRef.current = null;
    const { w, h } = layout.sizes[a.page];
    const pageLeft = (layout.width - w) / 2;
    el.scrollLeft = pageLeft + a.fx * w - a.vx;
    el.scrollTop = layout.tops[a.page] + a.fy * h - a.vy;
    onScroll();
  }, [layout, scale, onScroll]);

  /**
   * Zoom to `nextScale`, keeping the document point at content coords
   * (cx, cy) — measured in the current layout — under viewport point (vx, vy).
   */
  const zoomTo = useCallback((nextScale, cx, cy, vx, vy) => {
    const cur = layoutRef.current;
    const curScale = scaleRef.current;
    if (!cur || !curScale) return;
    const target = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    // Already at the limit: no re-layout will happen to consume an anchor.
    if (target === curScale) return;
    const page = pageAt(cur.tops, cy);
    const { w, h } = cur.sizes[page];
    const pageLeft = (cur.width - w) / 2;
    fitRef.current = false;
    anchorRef.current = { scale: target, page, fx: (cx - pageLeft) / w, fy: (cy - cur.tops[page]) / h, vx, vy };
    setScale(target);
  }, []);

  /** Zoom around a viewport point (defaults to the viewport centre). */
  const zoomAtViewport = useCallback(
    (nextScale, vx, vy) => {
      const el = scrollRef.current;
      const x = vx ?? el.clientWidth / 2;
      const y = vy ?? el.clientHeight / 2;
      zoomTo(nextScale, el.scrollLeft + x, el.scrollTop + y, x, y);
    },
    [zoomTo],
  );

  const fitWidth = useCallback(() => {
    if (!autoScale) return;
    fitRef.current = true;
    setScaleKeepingTop(autoScale);
  }, [autoScale, setScaleKeepingTop]);

  // Double-tap / double-click: zoom in on the spot, or back to fit width.
  const toggleZoom = useCallback(
    (vx, vy) => {
      if (!autoScale || !scaleRef.current) return;
      if (scaleRef.current > autoScale * 1.1) fitWidth();
      else zoomAtViewport(autoScale * 2.5, vx, vy);
    },
    [autoScale, fitWidth, zoomAtViewport],
  );
  // The gesture listeners are attached once; they call the latest versions.
  const toggleZoomRef = useRef(toggleZoom);
  const zoomAtViewportRef = useRef(zoomAtViewport);
  useLayoutEffect(() => {
    toggleZoomRef.current = toggleZoom;
    zoomAtViewportRef.current = zoomAtViewport;
  }, [toggleZoom, zoomAtViewport]);

  // ── Gestures ────────────────────────────────────────────────────────────
  // Native listeners: touchmove / wheel must be non-passive to stop the
  // browser zooming the whole page. Scrolling itself stays native (momentum,
  // rubber-banding); only pinch is handled here, previewed with a CSS
  // transform and committed as a re-layout + re-render when the fingers lift.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    let pinch = null;
    let tap = null;
    let lastTap = null;
    let wheel = null;

    const dist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const midpoint = (ts) => {
      const r = el.getBoundingClientRect();
      return { x: (ts[0].clientX + ts[1].clientX) / 2 - r.left, y: (ts[0].clientY + ts[1].clientY) / 2 - r.top };
    };
    const resetPreview = () => {
      content.style.transform = '';
      content.style.transformOrigin = '';
    };

    function onTouchStart(e) {
      if (e.touches.length === 1) {
        const tt = e.touches[0];
        tap = { x: tt.clientX, y: tt.clientY, time: Date.now() };
        return;
      }
      tap = null;
      if (e.touches.length !== 2 || !scaleRef.current) return;
      if (e.cancelable) e.preventDefault();
      const m = midpoint(e.touches);
      pinch = {
        startDist: dist(e.touches),
        start: m,
        last: m,
        ratio: 1,
        // Content coords under the fingers; the preview scales around it.
        origin: { x: el.scrollLeft + m.x, y: el.scrollTop + m.y },
        // If the browser already owns the gesture as a scroll, it moves the
        // content itself — only scale then, don't also translate.
        nativePan: false,
      };
      content.style.transformOrigin = `${pinch.origin.x}px ${pinch.origin.y}px`;
    }

    function onTouchMove(e) {
      if (tap) {
        const tt = e.touches[0];
        if (Math.hypot(tt.clientX - tap.x, tt.clientY - tap.y) > 10) tap = null;
      }
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      else pinch.nativePan = true;
      const s = scaleRef.current;
      const m = midpoint(e.touches);
      pinch.ratio = clamp(dist(e.touches) / pinch.startDist, MIN_SCALE / s, MAX_SCALE / s);
      pinch.last = m;
      const dx = pinch.nativePan ? 0 : m.x - pinch.start.x;
      const dy = pinch.nativePan ? 0 : m.y - pinch.start.y;
      content.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.ratio})`;
    }

    function onTouchEnd(e) {
      lastTouchRef.current = Date.now();
      if (pinch && e.touches.length < 2) {
        const { ratio, origin, last, nativePan } = pinch;
        pinch = null;
        resetPreview();
        if (Math.abs(ratio - 1) > 0.01) {
          const vx = nativePan ? origin.x - el.scrollLeft : last.x;
          const vy = nativePan ? origin.y - el.scrollTop : last.y;
          zoomTo(scaleRef.current * ratio, origin.x, origin.y, vx, vy);
        }
        lastTap = null;
        return;
      }
      if (!tap || e.touches.length > 0) return;
      const now = Date.now();
      const r = el.getBoundingClientRect();
      const point = { x: tap.x - r.left, y: tap.y - r.top };
      if (now - tap.time < 300) {
        if (lastTap && now - lastTap.time < 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
          if (e.cancelable) e.preventDefault();
          toggleZoomRef.current(point.x, point.y);
          lastTap = null;
        } else {
          lastTap = { ...point, time: now };
        }
      }
      tap = null;
    }

    function onTouchCancel() {
      if (pinch) resetPreview();
      pinch = null;
      tap = null;
    }

    // Trackpad pinch arrives as ctrl+wheel; Ctrl/Cmd+scroll with a mouse too.
    // Events within one frame are folded into a single zoom step.
    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, -100, 100);
      if (!wheel) {
        wheel = { factor: 1, x: 0, y: 0 };
        requestAnimationFrame(() => {
          const w = wheel;
          wheel = null;
          if (scaleRef.current) zoomAtViewportRef.current(scaleRef.current * w.factor, w.x, w.y);
        });
      }
      wheel.factor *= Math.exp(-delta * 0.01);
      wheel.x = e.clientX - r.left;
      wheel.y = e.clientY - r.top;
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    // iOS Safari zooms the whole page from its own gesture events.
    const stopGesture = (e) => e.preventDefault();
    el.addEventListener('gesturestart', stopGesture);
    el.addEventListener('gesturechange', stopGesture);
    return () => {
      el.removeEventListener('gesturestart', stopGesture);
      el.removeEventListener('gesturechange', stopGesture);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('wheel', onWheel);
    };
  }, [zoomTo]);

  // The page box holds the typed text while focused; null shows the page
  // currently in view.
  const [pageDraft, setPageDraft] = useState(null);
  const goToPage = useCallback((n) => {
    const cur = layoutRef.current;
    const el = scrollRef.current;
    if (!cur || !el || !cur.tops.length) return;
    const i = clamp(Math.round(n), 1, cur.tops.length) - 1;
    el.scrollTop = cur.tops[i] - PAD;
  }, []);

  const onDoubleClick = useCallback(
    (e) => {
      // Touch double-taps are handled in onTouchEnd; some browsers also
      // synthesize a dblclick for them.
      if (Date.now() - lastTouchRef.current < 1000) return;
      const r = scrollRef.current.getBoundingClientRect();
      toggleZoom(e.clientX - r.left, e.clientY - r.top);
    },
    [toggleZoom],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  // Only pages within one viewport above/below are mounted.
  const visible = [];
  let currentPage = 1;
  // Page stepping works from the page at the top edge, not the displayed
  // number: that one is sampled lower down, so with short (landscape) pages
  // stepping from it would skip pages.
  let prevTarget = 0;
  let nextTarget = 0;
  if (layout && numPages) {
    const h = viewport.height || 800;
    const first = pageAt(layout.tops, scrollTop - h);
    const last = pageAt(layout.tops, scrollTop + h * 2);
    for (let i = first; i <= last; i++) visible.push(i);
    currentPage = pageAt(layout.tops, scrollTop + h * 0.4) + 1;
    const top = pageAt(layout.tops, scrollTop + PAD + 1);
    const atBottom = scrollTop + h >= layout.height - 1;
    // Part-way down a page, "previous" first returns to that page's top.
    if (scrollTop > 0) prevTarget = scrollTop > layout.tops[top] - PAD + 1 ? top + 1 : top;
    if (!atBottom && top < numPages - 1) nextTarget = top + 2;
  }

  const zoomPct = scale ? Math.round((scale * 72 * 100) / 96) : 100;

  return (
    // Stops the stage's long-press context menu, which fires on any canvas
    // touch held 500 ms — i.e. during every slow pan or pinch.
    <div className="pdfv" onClick={onClick} onTouchStart={(e) => e.stopPropagation()}>
      <div ref={scrollRef} className="pdfv-scroll" onScroll={onScroll} onDoubleClick={onDoubleClick}>
        <div
          ref={contentRef}
          className="pdfv-content"
          style={layout ? { width: layout.width, height: layout.height } : undefined}
        >
          {layout &&
            visible.map((i) => {
              const { w, h } = layout.sizes[i];
              return (
                <PdfPage
                  key={i}
                  doc={doc}
                  pageNumber={i + 1}
                  top={layout.tops[i]}
                  left={(layout.width - w) / 2}
                  width={w}
                  height={h}
                  scale={scale}
                  onSize={onSize}
                />
              );
            })}
        </div>
      </div>

      {status.state === 'loading' && (
        <div className="pdfv-overlay">
          <div className="mv-loader-card">
            <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <span className="mv-loader-card__text">
              {t('viewer.pdfLoading')}
              {status.progress > 0 && ` ${Math.round(status.progress * 100)}%`}
            </span>
          </div>
        </div>
      )}

      {status.state === 'error' && (
        <div className="pdfv-overlay">
          <div className="mv-loader-card pdfv-error">
            <FiAlertTriangle size={22} color="var(--danger)" />
            <span className="mv-loader-card__text">
              {t(status.reason === 'password' ? 'viewer.pdfPasswordRequired' : 'viewer.pdfLoadFailed')}
            </span>
            <a className="pdfv-error__link" href={url} target="_blank" rel="noopener noreferrer">
              <FiExternalLink size={13} /> {t('viewer.pdfOpenNative')}
            </a>
          </div>
        </div>
      )}

      {status.state === 'ready' && (
        <div className="mv-toolbar">
          {numPages > 1 && (
            <>
              <button
                type="button"
                className="mv-toolbar__btn"
                title={t('viewer.pdfPrevPage')}
                disabled={!prevTarget}
                onClick={() => goToPage(prevTarget)}
              >
                <FiChevronUp size={16} />
              </button>
              <label className="mv-toolbar__page">
                <input
                  className="mv-toolbar__page-input"
                  inputMode="numeric"
                  aria-label={t('viewer.pdfGoToPage')}
                  title={t('viewer.pdfGoToPage')}
                  value={pageDraft ?? String(currentPage)}
                  style={{ width: `${String(numPages).length + 1}ch` }}
                  onFocus={(e) => {
                    setPageDraft(String(currentPage));
                    e.target.select();
                  }}
                  onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (pageDraft) goToPage(Number(pageDraft));
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      // Leave the box, not the viewer.
                      e.stopPropagation();
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={() => setPageDraft(null)}
                />
                <span>/ {numPages}</span>
              </label>
              <button
                type="button"
                className="mv-toolbar__btn"
                title={t('viewer.pdfNextPage')}
                disabled={!nextTarget}
                onClick={() => goToPage(nextTarget)}
              >
                <FiChevronDown size={16} />
              </button>
              <span className="mv-toolbar__sep" />
            </>
          )}
          <button type="button" className="mv-toolbar__btn" title={t('viewer.pdfZoomOut')} onClick={() => zoomAtViewport(scale / ZOOM_STEP)}>
            <FiZoomOut size={16} />
          </button>
          <button type="button" className="mv-toolbar__btn mv-toolbar__btn--text" title={t('viewer.pdfFitWidth')} onClick={fitWidth}>
            {zoomPct}%
          </button>
          <button type="button" className="mv-toolbar__btn" title={t('viewer.pdfZoomIn')} onClick={() => zoomAtViewport(scale * ZOOM_STEP)}>
            <FiZoomIn size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
