/** @format */

import { useState, useEffect, useRef } from 'react';
import { isImage, isVideo, isPdf } from '@/lib/clientFileUtils';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword, onImageLoad }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const loadVersionRef = useRef(0);
  const canThumbnail = isImage(file.name) || isVideo(file.name) || isPdf(file.name);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail, shareToken, sharePassword);
  const hasThumbnail = canThumbnail && thumbnailData?.data;

  // Reset when file changes
  useEffect(() => {
    // Increment version to ignore callbacks from previous image
    loadVersionRef.current += 1;
    setFullLoaded(false);
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
      {/* Thumbnail as placeholder */}
      {hasThumbnail && !fullLoaded && <img src={thumbnailData.data} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />}
      {/* Full-res image on top */}
      <img
        src={getFileUrl(file, 'image')}
        alt={file.name}
        className={`w-full h-full object-contain transition-opacity duration-300 ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={(e) => {
          // Only process if this is still the current image being loaded
          if (loadVersionRef.current === currentVersion) {
            setFullLoaded(true);
            if (onImageLoad) onImageLoad(e);
          }
        }}
        onError={() => {
          // Only process if this is still the current image being loaded
          if (loadVersionRef.current === currentVersion) {
            setFullLoaded(true);
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
