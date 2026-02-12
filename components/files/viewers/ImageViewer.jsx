/** @format */

import { useState, useEffect, useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const imgRef = useRef(null);
  const transformRef = useRef(null);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, true, shareToken, sharePassword);

  // Reset when file changes
  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  // Set src after img is mounted to ensure onLoad fires
  useEffect(() => {
    if (imgRef.current) {
      imgRef.current.src = getFileUrl(file, 'image');
    }
  }, [file, currentPath, shareToken, sharePassword]);

  return (
    <div
      className="relative w-full h-full flex items-center justify-center bg-gray-900"
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onTouchStart={(e) => {
        if (e.target.tagName === 'IMG') {
          e.preventDefault();
        }
      }}
    >
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
      <TransformWrapper ref={transformRef} minScale={0.95} maxScale={4} initialScale={1} centerContent={true} limitToWrapper={true} style={{ width: '100%', height: '100%' }}>
        <TransformComponent
          wrapperStyle={{
            width: '100%',
            height: '100%',
          }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <div className="w-full h-full">
            <img
              ref={imgRef}
              alt={file.name}
              draggable={false}
              className={`w-full h-full object-contain ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => {
                setFullLoaded(true);
                transformRef.current?.resetTransform();
              }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
            />
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
