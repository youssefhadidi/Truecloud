/** @format */

import { useState, useEffect, useRef, useCallback } from 'react';
import { isImage } from '@/lib/clientFileUtils';

export function useMediaViewerState(viewerFile, viewableFiles) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const stripRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const transformRef = useRef();

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
    transformRef,
    currentIndex,
    canGoPrev,
    canGoNext,
  };
}

export function useMediaViewerScroll(stripRef, programmaticScrollRef, viewerFile, viewableFiles, onSelectFile) {
  // Auto-center the active thumbnail in the strip
  useEffect(() => {
    if (!stripRef.current || !viewerFile) return;
    programmaticScrollRef.current = true;
    const active = stripRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ inline: 'center', behavior: 'instant', block: 'nearest' });
    }
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 500);
  }, [viewerFile?.id, stripRef, programmaticScrollRef, onSelectFile]);

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

export function useMediaViewerPreload(viewerFile, viewableFiles, getFileUrl) {
  // Preload adjacent full-res images for faster navigation
  useEffect(() => {
    if (!viewerFile || viewableFiles.length <= 1) return;

    const idx = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    const prev = idx > 0 ? viewableFiles[idx - 1] : null;
    const next = idx < viewableFiles.length - 1 ? viewableFiles[idx + 1] : null;

    const preloadImage = (file) => {
      if (!file || !isImage(file.name)) return;

      const url = getFileUrl(file, 'image');
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'image';
      link.href = url;
      document.head.appendChild(link);

      return () => {
        if (document.head.contains(link)) {
          document.head.removeChild(link);
        }
      };
    };

    const cleanupPrev = preloadImage(prev);
    const cleanupNext = preloadImage(next);

    return () => {
      if (cleanupPrev) cleanupPrev();
      if (cleanupNext) cleanupNext();
    };
  }, [viewerFile, viewableFiles, getFileUrl]);
}
