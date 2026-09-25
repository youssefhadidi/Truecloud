/** @format */

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ThumbnailItem from './ThumbnailItem';
import { useStableCallback } from '@/hooks/useStableCallbacks';
import { stripGeometry } from './hooks/useMediaViewerState';

// Only thumbnails near the visible part of the strip are mounted: a folder of
// thousands of photos would otherwise mount thousands of buttons (each with an
// IntersectionObserver) on open and re-render all of them on every step.
// OVERSCAN thumbnails are kept on each side; the window moves once the visible
// part comes within MARGIN of its edge, so a scroll re-renders the strip every
// couple dozen thumbnails rather than every frame.
const OVERSCAN = 30;
const MARGIN = 10;

function windowAround(first, last, count) {
  return { first: Math.max(0, first - OVERSCAN), last: Math.min(count - 1, last + OVERSCAN) };
}

// Stands in for `count` unmounted thumbnails. Sized in CSS from the same
// variables as the thumbnails (so it is right from the first render, before
// anything is measured); it is followed by one flex gap, hence the "- gap".
// Every mounted thumbnail thus keeps the offsetLeft it would have with the
// whole list mounted.
function Spacer({ count }) {
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: `calc(${count} * (var(--mv-thumb-size) + var(--mv-strip-gap)) - var(--mv-strip-gap))`,
      }}
    />
  );
}

export default function ThumbnailStrip({
  files,
  activeId,
  currentPath,
  shareToken,
  sharePassword,
  onSelect,
  glass = false,
  onScroll,
  stripRef: externalRef,
}) {
  const internalRef = useRef(null);
  const stripRef = externalRef || internalRef;
  const count = files.length;

  // Start with the window centred on the active file: that is where the viewer
  // scrolls the strip to on open.
  const [range, setRange] = useState(() => {
    const active = Math.max(0, files.findIndex((f) => f.id === activeId));
    return windowAround(active, active, count);
  });

  const rafRef = useRef(0);

  const updateRange = useStableCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const { padLeft, pitch } = stripGeometry(el);
    const first = Math.max(0, Math.floor((el.scrollLeft - padLeft) / pitch));
    const last = Math.min(count - 1, Math.ceil((el.scrollLeft + el.clientWidth - padLeft) / pitch));
    setRange((prev) => {
      const covered =
        prev.first <= Math.max(0, first - MARGIN) && prev.last >= Math.min(count - 1, last + MARGIN) && prev.last < count;
      return covered ? prev : windowAround(first, last, count);
    });
  });

  // Recompute when the file list changes and when the strip resizes
  // (fullscreen toggle, rotation; the thumbnail size and gap also change at the
  // mobile breakpoint). Not on mount: the strip is still at scrollLeft 0 then,
  // until the viewer centres it, and the initial window is already the right one.
  const countRef = useRef(count);
  useLayoutEffect(() => {
    if (countRef.current === count) return;
    countRef.current = count;
    updateRange();
  }, [count, updateRange]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // includes the initial observation
      width = el.clientWidth;
      updateRange();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [stripRef, updateRange]);

  const handleScroll = useCallback(
    (e) => {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          updateRange();
        });
      }
      onScroll?.(e);
    },
    [updateRange, onScroll],
  );

  // Auto-centering of the active thumbnail is owned by useMediaViewerScroll
  // (in MediaViewer), which guards against the scroll re-triggering selection.
  // A second centering effect here would race with it.

  // A mouse wheel only scrolls vertically; turn it into horizontal scrolling
  // so the strip can be scrubbed without a trackpad. Non-passive listener:
  // React's onWheel can't preventDefault.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    function onWheel(e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already horizontal
      e.preventDefault();
      // Instant: the strip's CSS smooth scrolling would restart an animation
      // on every wheel tick and swallow most of them.
      el.scrollBy({ left: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, behavior: 'instant' });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stripRef]);

  const first = Math.min(range.first, Math.max(0, count - 1));
  const last = Math.min(range.last, count - 1);

  return (
    <div className={`mv-strip${glass ? ' mv-strip--glass' : ''}`}>
      <div ref={stripRef} className="mv-strip__scroll" onScroll={handleScroll}>
        {first > 0 && <Spacer count={first} />}
        {files.slice(first, last + 1).map((file) => (
          <div key={file.id} className="mv-strip__item" data-file-id={file.id} data-active={file.id === activeId ? 'true' : undefined}>
            <ThumbnailItem
              file={file}
              currentPath={currentPath}
              isActive={file.id === activeId}
              glass={glass}
              shareToken={shareToken}
              sharePassword={sharePassword}
              onSelect={onSelect}
            />
          </div>
        ))}
        {last < count - 1 && <Spacer count={count - 1 - last} />}
      </div>
    </div>
  );
}
