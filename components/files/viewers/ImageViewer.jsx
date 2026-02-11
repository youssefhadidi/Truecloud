/** @format */

import { useState, useEffect, useRef } from 'react';
import { isImage, isVideo, isPdf } from '@/lib/clientFileUtils';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword, onImageLoad }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const loadVersionRef = useRef(0);
  const imgRef = useRef(null);
  const onImageLoadRef = useRef(onImageLoad);

  const canThumbnail = isImage(file.name) || isVideo(file.name) || isPdf(file.name);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail, shareToken, sharePassword);
  const hasThumbnail = canThumbnail && thumbnailData?.data;

  // Keep ref in sync with latest callback
  useEffect(() => {
    onImageLoadRef.current = onImageLoad;
  }, [onImageLoad]);

  // Reset when file changes
  useEffect(() => {
    // Increment version to ignore callbacks from previous image
    loadVersionRef.current += 1;
    setFullLoaded(false);
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  // Monitor image load state and handle cached/synchronous loads
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    let animationFrameId;
    let timeoutId;

    const handleLoad = () => {
      if (loadVersionRef.current === currentVersion) {
        setFullLoaded(true);
        if (onImageLoadRef.current) onImageLoadRef.current({ target: img });
      }
    };

    const handleError = () => {
      if (loadVersionRef.current === currentVersion) {
        setFullLoaded(true);
      }
    };

    const checkIfLoaded = () => {
      // Check if image completed loading (handles cached images)
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
        return;
      }

      // Fallback: check again after a short delay if still loading
      if (loadVersionRef.current === currentVersion && !img.complete) {
        timeoutId = setTimeout(checkIfLoaded, 100);
      }
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);

    // Defer the check to allow browser to process image loading
    animationFrameId = requestAnimationFrame(() => {
      requestAnimationFrame(checkIfLoaded);
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(timeoutId);
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [file.id]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
      {/* Thumbnail as placeholder */}
      {hasThumbnail && !fullLoaded && <img src={thumbnailData.data} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />}

      {/* Loading spinner - visible while full image is loading */}
      {!fullLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-12 h-12 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Full-res image on top */}
      <img
        ref={imgRef}
        src={getFileUrl(file, 'image')}
        alt={file.name}
        key={file.id}
        className={`w-full h-full object-contain ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
