/** @format */

import { useState, useEffect, useRef, useCallback } from 'react';
import { isImage } from '@/lib/clientFileUtils';

export function useMediaViewerState(viewerFile, viewableFiles) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const stripRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const programmaticScrollRef = useRef(false);

  // Initialize fullscreen state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mediaViewerFullscreen');
      if (saved !== null) {
        setIsFullscreen(JSON.parse(saved));
      }
    }
  }, []);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
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
    scrollTimeoutRef,
    programmaticScrollRef,
    currentIndex,
    canGoPrev,
    canGoNext,
  };
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
    const active = strip.querySelector('[data-active="true"]');
    if (!active) return undefined;
    programmaticScrollRef.current = true;
    // Same coordinate space as getCenteredFile (offsetLeft vs scrollLeft).
    const target = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({ left: target, behavior: 'instant' });
    const id = setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 300);
    return () => clearTimeout(id);
  }, [viewerFile?.id, viewableFiles, stripRef, programmaticScrollRef]);

  // Find the file whose thumbnail is closest to the strip center
  const getCenteredFile = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return null;
    const centerX = strip.scrollLeft + strip.clientWidth / 2;
    let closest = null;
    let closestDist = Infinity;
    for (const child of strip.children) {
      const childCenter = child.offsetLeft + child.offsetWidth / 2;
      const dist = Math.abs(childCenter - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = child;
      }
    }
    if (!closest) return null;
    const fileId = closest.dataset.fileId;
    return viewableFiles.find((f) => f.id === fileId) || null;
  }, [stripRef, viewableFiles]);

  // Handle strip scroll - change viewed file when scrolling settles
  const handleStripScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;

    const timeoutId = setTimeout(() => {
      const centeredFile = getCenteredFile();
      if (centeredFile && centeredFile.id !== viewerFile?.id) {
        onSelectFile(centeredFile);
      }
    }, 150);

    return timeoutId;
  }, [getCenteredFile, viewerFile, onSelectFile, programmaticScrollRef]);

  return { handleStripScroll, getCenteredFile };
}
