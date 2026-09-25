/** @format */

import { useState, useEffect, useRef, useCallback } from 'react';

// A touch device is judged by its short edge so a phone stays "mobile" in
// landscape — flipping on rotation would swap the viewer's layout mid-playback.
function detectMobile() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return window.innerWidth < 768 || (coarse && Math.min(window.innerWidth, window.innerHeight) < 768);
}

function savedFullscreen() {
  try {
    const saved = localStorage.getItem('mediaViewerFullscreen');
    return saved !== null ? Boolean(JSON.parse(saved)) : false;
  } catch {
    return false;
  }
}

export function useMediaViewerState(viewerFile, viewableFiles) {
  // Read synchronously rather than in an effect: the viewer mounts when a file
  // is opened, and an effect would first paint it windowed, then switch it to
  // fullscreen (on phones, or when that was the last choice).
  const [isFullscreen, setIsFullscreen] = useState(() => typeof window !== 'undefined' && savedFullscreen());
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && detectMobile());
  const stripRef = useRef(null);
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(detectMobile());
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Save fullscreen state to localStorage
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const newState = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('mediaViewerFullscreen', JSON.stringify(newState));
      }
      return newState;
    });
  }, []);

  const currentIndex = viewerFile ? viewableFiles.findIndex((f) => f.id === viewerFile.id) : -1;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < viewableFiles.length - 1;
  const effectiveFullscreen = isMobile || isFullscreen;

  return {
    isFullscreen,
    isMobile,
    effectiveFullscreen,
    toggleFullscreen,
    stripRef,
    programmaticScrollRef,
    currentIndex,
    canGoPrev,
    canGoNext,
  };
}

/**
 * Thumbnail strip layout, read from its CSS: thumbnail i sits at
 * padLeft + i * pitch. ThumbnailStrip only mounts the thumbnails near the
 * visible part, so positions are computed from the index rather than read off
 * elements that may not exist.
 */
export function stripGeometry(strip) {
  const style = getComputedStyle(strip);
  const width = parseFloat(style.getPropertyValue('--mv-thumb-size')) || 64;
  const gap = parseFloat(style.getPropertyValue('--mv-strip-gap')) || 0;
  return { width, gap, pitch: width + gap, padLeft: parseFloat(style.paddingLeft) || 0 };
}

export function useMediaViewerScroll(stripRef, programmaticScrollRef, viewerFile, viewableFiles, onSelectFile) {
  // Auto-center the active thumbnail in the strip.
  //
  // We scroll the strip element directly rather than using
  // active.scrollIntoView(): scrollIntoView also scrolls every scrollable
  // ancestor (e.g. the public share page's document-level gallery), which
  // would yank the background to a different image. The authenticated viewer
  // happens to lock body scroll so it never showed the bug, but the
  // element-scoped scroll below is correct for both.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !viewerFile) return undefined;
    const index = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    if (index < 0) return undefined;
    programmaticScrollRef.current = true;
    const { width, pitch, padLeft } = stripGeometry(strip);
    const target = padLeft + index * pitch - (strip.clientWidth - width) / 2;
    strip.scrollTo({ left: target, behavior: 'instant' });
    const id = setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 300);
    return () => clearTimeout(id);
  }, [viewerFile?.id, viewableFiles, stripRef, programmaticScrollRef]);

  // Find the file whose thumbnail is closest to the strip center
  const getCenteredFile = useCallback(() => {
    const strip = stripRef.current;
    if (!strip || viewableFiles.length === 0) return null;
    const { width, pitch, padLeft } = stripGeometry(strip);
    const centerX = strip.scrollLeft + strip.clientWidth / 2;
    const index = Math.round((centerX - padLeft - width / 2) / pitch);
    return viewableFiles[Math.min(viewableFiles.length - 1, Math.max(0, index))];
  }, [stripRef, viewableFiles]);

  // Change the viewed file once scrolling settles. Debounced (not a timer per
  // scroll event): during a fling every intermediate file would otherwise be
  // selected in turn, each one starting a full-size load.
  const settleTimerRef = useRef(null);
  const handleStripScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const centeredFile = getCenteredFile();
      if (centeredFile && centeredFile.id !== viewerFile?.id) {
        onSelectFile(centeredFile);
      }
    }, 150);
  }, [getCenteredFile, viewerFile, onSelectFile, programmaticScrollRef]);

  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  return { handleStripScroll, getCenteredFile };
}
