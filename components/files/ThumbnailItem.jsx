/** @format */

import { useState, useEffect, useRef } from 'react';
import { FiBox, FiVideo, FiMusic, FiFileText, FiFile, FiImage } from 'react-icons/fi';
import { getFileType } from '@/lib/getFileType';
import { useShareAwareThumbnail } from './hooks/useShareAwareThumbnail';

export function ThumbnailItem({ file, currentPath, isActive, onClick, shareToken, sharePassword }) {
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
      { rootMargin: '100px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fileType = getFileType(file);

  const canThumbnail = fileType === 'image' || fileType === 'video' || fileType === 'pdf';
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail && isVisible, shareToken, sharePassword);

  const iconMap = {
    '3d': <FiBox size={20} className="text-orange-400" />,
    video: <FiVideo size={20} className="text-blue-400" />,
    audio: <FiMusic size={20} className="text-purple-400" />,
    pdf: <FiFileText size={20} className="text-red-400" />,
    xlsx: <FiFile size={20} className="text-green-400" />,
    image: <FiImage size={20} className="text-green-400" />,
  };

  const hasThumbnail = canThumbnail && thumbnailData?.data;

  return (
    <button
      ref={itemRef}
      onClick={onClick}
      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
        isActive ? 'border-blue-500 ring-2 ring-blue-500/40 scale-105' : 'border-gray-700 hover:border-gray-500'
      } bg-gray-800 flex items-center justify-center`}
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      title={file.name}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        if (e.target.tagName === 'IMG') {
          e.preventDefault();
        }
      }}
    >
      {hasThumbnail ? (
        <img src={thumbnailData.data} alt={file.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        iconMap[fileType] || <FiFile size={20} className="text-gray-500" />
      )}
    </button>
  );
}
