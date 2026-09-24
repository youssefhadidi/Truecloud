/** @format */

'use client';

import { useEffect, useRef } from 'react';
import ThumbnailItem from './ThumbnailItem';

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

  return (
    <div className={`mv-strip${glass ? ' mv-strip--glass' : ''}`}>
      <div ref={stripRef} className="mv-strip__scroll" onScroll={onScroll}>
        {files.map((file) => (
          <div key={file.id} className="mv-strip__item" data-file-id={file.id} data-active={file.id === activeId ? 'true' : undefined}>
            <ThumbnailItem
              file={file}
              currentPath={currentPath}
              isActive={file.id === activeId}
              glass={glass}
              shareToken={shareToken}
              sharePassword={sharePassword}
              onClick={() => onSelect(file)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
