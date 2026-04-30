/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { FiBox, FiVideo, FiMusic, FiFileText, FiFile, FiImage, FiGrid } from 'react-icons/fi';
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
};

// Named export for legacy import sites; default export matches the design API.
export function ThumbnailItem({ file, currentPath, isActive, onClick, shareToken, sharePassword, glass = false }) {
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
      onClick={onClick}
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
    </button>
  );
}

export default ThumbnailItem;
