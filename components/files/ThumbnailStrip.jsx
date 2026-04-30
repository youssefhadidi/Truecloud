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

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector('[data-active="true"]');
    if (!active) return;
    const stripRect = strip.getBoundingClientRect();
    const childRect = active.getBoundingClientRect();
    const offset = childRect.left - stripRect.left - (stripRect.width - childRect.width) / 2;
    strip.scrollBy({ left: offset, behavior: 'smooth' });
  }, [activeId, files, stripRef]);

  return (
    <div className={`mv-strip${glass ? ' mv-strip--glass' : ''}`}>
      <div ref={stripRef} className="mv-strip__scroll" onScroll={onScroll}>
        {files.map((file) => (
          <div key={file.id} data-file-id={file.id} data-active={file.id === activeId ? 'true' : undefined}>
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
