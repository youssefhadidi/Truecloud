/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiArrowLeft, FiChevronRight, FiVideo, FiFileText, FiMaximize2, FiMinimize2 } from 'react-icons/fi';
import Viewer3D, { is3dFile } from './Viewer3D';
import XlsxViewer from './XlsxViewer';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [touchStartX, setTouchStartX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Helper to check if file is HEIC
  const isHeic = (fileName) => {
    const ext = fileName.toLowerCase();
    return ext.endsWith('.heic') || ext.endsWith('.heif');
  };

  // Helper to build download URL
  const getFileUrl = (file, type) => {
    // Use conversion endpoint for HEIC files
    if (type === 'image' && isHeic(file.name)) {
      return `/api/files/convert-heic?id=${encodeURIComponent(file.name)}&path=${encodeURIComponent(currentPath)}`;
    }
    // Use optimization endpoint for images for faster loading
    if (type === 'image') {
      return `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=85&w=2000&h=2000`;
    }
    const baseUrl = `/api/files/${type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download'}/${file.id}`;
    return `${baseUrl}?path=${encodeURIComponent(currentPath)}`;
  };

  // Helper to determine file type
  const getFileType = (file) => {
    if (is3dFile(file.name)) return '3d';
    if (isImage(file.name)) return 'image';
    if (isVideo(file.name)) return 'video';
    if (isAudio(file.name)) return 'audio';
    if (isPdf(file.name)) return 'pdf';
    if (isXlsx(file.name)) return 'xlsx';
    return null;
  };

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

  // Reset loading state when file changes
  useEffect(() => {
    setIsLoading(true);
  }, [viewerFile?.id]);

  // Preload adjacent images for faster navigation
  useEffect(() => {
    if (!viewerFile || viewableFiles.length <= 1) return;

    const currentIndex = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    const prevFile = currentIndex > 0 ? viewableFiles[currentIndex - 1] : null;
    const nextFile = currentIndex < viewableFiles.length - 1 ? viewableFiles[currentIndex + 1] : null;

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

    const cleanupPrev = preloadImage(prevFile);
    const cleanupNext = preloadImage(nextFile);

    return () => {
      if (cleanupPrev) cleanupPrev();
      if (cleanupNext) cleanupNext();
    };
  }, [viewerFile, viewableFiles]);

  // Save fullscreen state to localStorage
  const toggleFullscreen = () => {
    const newState = !isFullscreen;
    setIsFullscreen(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mediaViewerFullscreen', JSON.stringify(newState));
    }
  };

  // Check if touch target is an interactive element
  const isInteractiveElement = (target) => {
    return (
      target.tagName === 'VIDEO' ||
      target.tagName === 'AUDIO' ||
      target.tagName === 'BUTTON' ||
      target.closest('iframe') || // PDF
      target.closest('canvas') || // 3D viewer
      target.closest('button') ||
      target.closest('[data-no-swipe]')
    );
  };

  // Handle touch start
  const handleTouchStart = (e) => {
    if (viewableFiles.length <= 1 || isInteractiveElement(e.target)) return;

    setTouchStartX(e.touches[0].clientX);
    setIsDragging(true);
    setIsTransitioning(false);
  };

  // Handle touch move
  const handleTouchMove = (e) => {
    if (!isDragging || viewableFiles.length <= 1) return;

    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;

    const currentIndex = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    const isAtStart = currentIndex === 0;
    const isAtEnd = currentIndex === viewableFiles.length - 1;

    // Apply resistance at boundaries (rubber-band effect)
    let resistance = 1;
    if ((isAtStart && diff > 0) || (isAtEnd && diff < 0)) {
      resistance = 0.3; // Slow down at boundaries
    }

    setTranslateX(diff * resistance);
  };

  // Handle touch end
  const handleTouchEnd = () => {
    if (!isDragging) return;

    const threshold = 100; // pixels
    const velocity = Math.abs(translateX) > 30; // Fast swipe

    if (Math.abs(translateX) > threshold || velocity) {
      if (translateX > 0) {
        onNavigate('prev');
      } else {
        onNavigate('next');
      }
    }

    // Reset state
    setIsDragging(false);
    setTranslateX(0);
    setIsTransitioning(true);

    // Clear transitioning state after animation
    const timer = setTimeout(() => setIsTransitioning(false), 300);
    return () => clearTimeout(timer);
  };

  if (!viewerFile) return null;

  const fileType = getFileType(viewerFile);

  // Render media based on type
  const renderMedia = () => {
    const containerClass = 'w-full h-full object-contain';
    const stopProp = (e) => e.stopPropagation();

    switch (fileType) {
      case '3d':
        return <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} onClick={stopProp} />;

      case 'image':
        return (
          <div className="relative w-full h-full flex items-center justify-center">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-50">
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
                  <p className="text-gray-300 text-sm">Loading image...</p>
                </div>
              </div>
            )}
            <img 
              src={getFileUrl(viewerFile, 'image')} 
              alt={viewerFile.name} 
              className={containerClass}
              onClick={stopProp}
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
            />
          </div>
        );

      case 'video':
        return (
          <video controls autoPlay className={containerClass} src={getFileUrl(viewerFile, 'video')} onClick={stopProp} style={{ width: '100%', height: '100%' }}>
            Your browser does not support video playback.
          </video>
        );

      case 'audio':
        return (
          <div className="flex flex-col items-center gap-4 w-full" onClick={stopProp}>
            <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center">
              <FiVideo size={64} className="text-blue-400" />
            </div>
            <audio controls className="w-full" src={getFileUrl(viewerFile, 'audio')} style={{ width: '100%' }}>
              Your browser does not support audio playback.
            </audio>
          </div>
        );

      case 'pdf':
        return <iframe src={getFileUrl(viewerFile, 'pdf')} className="w-full h-full" title={viewerFile.name} onClick={stopProp} />;

      case 'xlsx':
        return <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} onClick={stopProp} />;

      default:
        return <div className="text-gray-400">Unsupported file type</div>;
    }
  };

  return (
    <div
      className={`${isFullscreen ? 'fixed inset-0 z-50' : 'fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-1'}`}
      onClick={isFullscreen ? null : onClose}
    >
      <div
        className={`${isFullscreen ? 'w-screen h-screen rounded-none' : 'relative bg-gray-900 rounded-lg shadow-xl w-full max-w-[1600px] h-[90vh]'} bg-gray-900 flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{viewerFile.name}</h3>
            {viewableFiles.length > 1 && (
              <p className=" text-gray-400">
                {viewableFiles.findIndex((f) => f.id === viewerFile.id) + 1} / {viewableFiles.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700">
            <button
              onClick={toggleFullscreen}
              className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md border-r border-gray-700 last:border-r-0"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <FiMinimize2 size={18} /> : <FiMaximize2 size={18} />}
            </button>
            <button onClick={onClose} className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md" title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Media Content */}
        <div
          className="flex-1 overflow-auto flex items-center justify-center p-1 relative select-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              transform: isDragging ? `translateX(${translateX}px)` : 'translateX(0)',
              transition: isTransitioning ? 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
          >
            {renderMedia()}
          </div>

          {/* Navigation Buttons - Only show on desktop if multiple viewable files */}
          {viewableFiles.length > 1 && !isMobile && (
            <>
              <button
                onClick={() => onNavigate('prev')}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all opacity-0 hover:opacity-100"
                title="Previous (← key or swipe)"
                style={{ zIndex: 50 }}
              >
                <FiArrowLeft size={24} />
              </button>

              <button
                onClick={() => onNavigate('next')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all opacity-0 hover:opacity-100"
                title="Next (→ key or swipe)"
                style={{ zIndex: 50 }}
              >
                <FiChevronRight size={24} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
