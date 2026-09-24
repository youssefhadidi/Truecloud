/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { FiZoomIn, FiZoomOut } from 'react-icons/fi';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';
import { useTranslation } from '@/components/LanguageProvider';

const MAX_SCALE = 6;
const ZOOM_STEP = 0.5; // react-zoom-pan-pinch step: scale × e^step per click
// A horizontal flick at least this long (px), mostly sideways and quick,
// moves to the neighbouring file. Only when not zoomed — a zoomed image
// needs the same gesture to pan.
const SWIPE_MIN_DX = 50;
const SWIPE_MAX_MS = 600;

export function ImageViewer({ file, currentPath, getFileUrl, shareToken, sharePassword, onSwipe }) {
  const { t } = useTranslation();
  const [fullLoaded, setFullLoaded] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const transformRef = useRef(null);
  const scaleRef = useRef(1);
  const onSwipeRef = useRef(onSwipe);
  const thumbnailUrl = useShareAwareThumbnail(file, currentPath, true, shareToken, sharePassword);

  useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  useEffect(() => {
    if (imgRef.current) {
      imgRef.current.src = getFileUrl(file, 'image');
    }
  }, [file, currentPath, shareToken, sharePassword, getFileUrl]);

  // Swipe detection. Capture-phase listeners so the zoom library's own touch
  // handling can't hide the gesture from us; passive, so native behaviour is
  // untouched.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    let start = null;

    function onStart(e) {
      start =
        e.touches.length === 1 && scaleRef.current <= 1.01
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() }
          : null; // a second finger means pinch, not swipe
    }
    function onEnd(e) {
      if (!start || e.touches.length > 0) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const quick = Date.now() - start.time < SWIPE_MAX_MS;
      start = null;
      if (quick && Math.abs(dx) >= SWIPE_MIN_DX && Math.abs(dx) > Math.abs(dy) * 1.5 && scaleRef.current <= 1.01) {
        onSwipeRef.current?.(dx < 0 ? 'next' : 'prev');
      }
    }
    function onCancel() {
      start = null;
    }

    el.addEventListener('touchstart', onStart, { capture: true, passive: true });
    el.addEventListener('touchend', onEnd, { capture: true, passive: true });
    el.addEventListener('touchcancel', onCancel, { capture: true, passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart, { capture: true });
      el.removeEventListener('touchend', onEnd, { capture: true });
      el.removeEventListener('touchcancel', onCancel, { capture: true });
    };
  }, []);

  function handleZoomChange({ state }) {
    scaleRef.current = state.scale;
    setZoomScale(state.scale);
  }

  const zoomed = zoomScale > 1.01;

  return (
    <div
      ref={stageRef}
      className={`mv-image-stage${zoomed ? ' is-zoomed' : ''}`}
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
        minScale={1}
        maxScale={MAX_SCALE}
        initialScale={1}
        wheel={{ step: 0.08 }}
        doubleClick={{ mode: 'toggle', step: 1 }}
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
            className={`mv-image-stage__img mv-image-stage__img--main ${fullLoaded ? 'mv-image-stage__img--loaded' : 'mv-image-stage__img--loading'}`}
            onLoad={() => {
              setFullLoaded(true);
              transformRef.current?.resetTransform(0);
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
          />
        </TransformComponent>
      </TransformWrapper>

      {fullLoaded && (
        <div className="mv-toolbar mv-toolbar--image" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="mv-toolbar__btn"
            title={t('viewer.zoomOut')}
            disabled={!zoomed}
            onClick={() => transformRef.current?.zoomOut(ZOOM_STEP)}
          >
            <FiZoomOut size={16} />
          </button>
          <button
            type="button"
            className="mv-toolbar__btn mv-toolbar__btn--text"
            title={t('viewer.resetZoom')}
            onClick={() => transformRef.current?.resetTransform()}
          >
            {Math.round(zoomScale * 100)}%
          </button>
          <button
            type="button"
            className="mv-toolbar__btn"
            title={t('viewer.zoomIn')}
            disabled={zoomScale >= MAX_SCALE - 0.01}
            onClick={() => transformRef.current?.zoomIn(ZOOM_STEP)}
          >
            <FiZoomIn size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
