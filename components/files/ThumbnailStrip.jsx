/** @format */

'use client';

import { useRef } from 'react';
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
