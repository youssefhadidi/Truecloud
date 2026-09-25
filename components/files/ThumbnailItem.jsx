/** @format */

'use client';

import { memo, useState, useEffect, useRef } from 'react';
import { FiBox, FiVideo, FiMusic, FiFileText, FiFile, FiImage, FiGrid, FiPlay } from 'react-icons/fi';
import { getFileType } from '@/lib/getFileType';
import { useShareAwareThumbnail } from './hooks/useShareAwareThumbnail';
import { fileKind } from '@/components/files/fileKindUtils';

const TYPE_ICONS = {
  image: FiImage,
  video: FiVideo,
  audio: FiMusic,
  pdf:   FiFileText,
  '3d':  FiBox,
  xlsx:  FiGrid,
  sheet: FiGrid,
  text:  FiFileText,
};

// Named export for legacy import sites; default export matches the design API.
export function ThumbnailItem({ file, currentPath, isActive, onSelect, shareToken, sharePassword, glass = false }) {
  const itemRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fileType = getFileType(file);
  const canThumbnail = fileType === 'image' || fileType === 'video' || fileType === 'pdf';
  const thumbnailUrl = useShareAwareThumbnail(file, currentPath, canThumbnail && isVisible, shareToken, sharePassword);

  const Icon = TYPE_ICONS[fileType] || TYPE_ICONS[fileKind(file)] || FiFile;

  return (
    <button
      ref={itemRef}
      type="button"
      aria-label={file.name}
      aria-pressed={isActive}
      onClick={() => onSelect(file)}
      className={[
        'mv-thumb',
        isActive ? 'mv-thumb--active' : '',
        glass ? 'mv-thumb--glass' : '',
      ].join(' ')}
      title={file.name}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        if (e.target.tagName === 'IMG') e.preventDefault();
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="mv-thumb__inner"
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div className={`mv-thumb__inner ft-${fileKind(file)}`}>
          <Icon size={20} />
        </div>
      )}
      {/* A video or PDF thumbnail looks like any other picture; mark it. */}
      {thumbnailUrl && fileType === 'video' && (
        <span className="mv-thumb__badge" aria-hidden="true">
          <FiPlay size={9} />
        </span>
      )}
      {thumbnailUrl && fileType === 'pdf' && (
        <span className="mv-thumb__badge mv-thumb__badge--text" aria-hidden="true">
          PDF
        </span>
      )}
    </button>
  );
}

// Memo'd: stepping through files changes isActive on two thumbnails only.
export default memo(ThumbnailItem);
