/** @format */

import { useState, useEffect, forwardRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export const ImageViewer = forwardRef(function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword, transformRef }, ref) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, true, shareToken, sharePassword);

  // Reset when file changes
  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
      {/* Thumbnail as placeholder */}
      {thumbnailData?.data && !fullLoaded && (
        <img src={thumbnailData.data} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />
      )}

      {/* Loading spinner - visible while full image is loading */}
      {!fullLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-12 h-12 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Full-res image wrapped in transform */}
      <TransformWrapper minScale={0.5} maxScale={4} initialScale={1} centerOnInit={false} ref={transformRef}>
        <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
          <img
            src={getFileUrl(file, 'image')}
            alt={file.name}
            key={file.id}
            className={`w-full h-full object-contain ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => {
              setFullLoaded(true);
              // object-contain CSS already constrains image to fit perfectly
              // No need to apply additional scale - let user zoom with mouse wheel/pinch
              if (transformRef) {
                transformRef.current?.resetTransform?.();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});
