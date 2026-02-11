/** @format */

import { useState, useEffect, useRef, forwardRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export const ImageViewer = forwardRef(function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword, transformRef }, ref) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [calculatedScale, setCalculatedScale] = useState(1);
  const wrapperRef = useRef(null);
  const imgRef = useRef(null);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, true, shareToken, sharePassword);

  // Reset when file changes
  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  // Calculate scale based on wrapper and image dimensions
  const calculateScale = () => {
    if (!wrapperRef.current || !imgRef.current || !imgRef.current.naturalWidth) return;

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const wrapperWidth = wrapperRect.width;
    const wrapperHeight = wrapperRect.height;

    const imgNaturalWidth = imgRef.current.naturalWidth;
    const imgNaturalHeight = imgRef.current.naturalHeight;

    // Calculate what the displayed size would be with object-contain
    const imgAspect = imgNaturalWidth / imgNaturalHeight;
    const wrapperAspect = wrapperWidth / wrapperHeight;

    let displayWidth, displayHeight;
    if (imgAspect > wrapperAspect) {
      // Image is wider - width is the limiting factor
      displayWidth = wrapperWidth;
      displayHeight = wrapperWidth / imgAspect;
    } else {
      // Image is taller - height is the limiting factor
      displayHeight = wrapperHeight;
      displayWidth = wrapperHeight * imgAspect;
    }

    // Calculate scale to fit within wrapper
    const scaleX = wrapperWidth / imgNaturalWidth;
    const scaleY = wrapperHeight / imgNaturalHeight;
    const scale = Math.min(scaleX, scaleY);

    setCalculatedScale(scale);
  };

  return (
    <div ref={wrapperRef} className="relative w-full h-full flex items-center justify-center bg-gray-900">
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
      <TransformWrapper
        minScale={0.5}
        maxScale={4}
        initialScale={calculatedScale}
        centerOnInit={true}
        limitToWrapper={true}
        ref={transformRef}
        style={{ width: '100%', height: '100%' }}
      >
        <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
          <img
            ref={imgRef}
            src={getFileUrl(file, 'image')}
            alt={file.name}
            key={file.id}
            className={`w-full h-full object-contain ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => {
              calculateScale();
              setFullLoaded(true);
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
