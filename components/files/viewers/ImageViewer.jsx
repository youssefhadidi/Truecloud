/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [showZoomPill, setShowZoomPill] = useState(false);
  const imgRef = useRef(null);
  const transformRef = useRef(null);
  const zoomTimer = useRef(null);
  const thumbnailUrl = useShareAwareThumbnail(file, currentPath, true, shareToken, sharePassword);

  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  useEffect(() => {
    if (imgRef.current) {
      imgRef.current.src = getFileUrl(file, 'image');
    }
  }, [file, currentPath, shareToken, sharePassword, getFileUrl]);

  function handleZoomChange({ state }) {
    setZoomScale(state.scale);
    if (state.scale > 1.01) {
      setShowZoomPill(true);
      clearTimeout(zoomTimer.current);
      zoomTimer.current = setTimeout(() => setShowZoomPill(false), 1800);
    } else {
      setShowZoomPill(false);
    }
  }

  return (
    <div
      className="mv-image-stage"
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onTouchStart={(e) => {
        if (e.target.tagName === 'IMG') e.preventDefault();
      }}
    >
      {/* Loading spinner */}
      {!fullLoaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <div className="mv-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
        </div>
      )}

      {/* Thumbnail placeholder */}
      {thumbnailUrl && !fullLoaded && (
        <img
          src={thumbnailUrl}
          alt=""
          className="mv-image-stage__img mv-image-stage__img--loaded"
          style={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            filter: 'blur(12px)',
            transform: 'scale(1.05)',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
      )}

      <TransformWrapper
        ref={transformRef}
        minScale={0.95}
        maxScale={6}
        initialScale={1}
        wheel={{ step: 0.08 }}
        doubleClick={{ mode: 'reset' }}
        onTransformed={handleZoomChange}
        centerOnInit
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            ref={imgRef}
            alt={file.name}
            draggable={false}
            className={`mv-image-stage__img ${fullLoaded ? 'mv-image-stage__img--loaded' : 'mv-image-stage__img--loading'}`}
            onLoad={() => {
              setFullLoaded(true);
              transformRef.current?.resetTransform();
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
          />
        </TransformComponent>
      </TransformWrapper>

      {showZoomPill && zoomScale > 1.01 && (
        <div className="mv-zoom-pill">{Math.round(zoomScale * 100)}%</div>
      )}
    </div>
  );
}
