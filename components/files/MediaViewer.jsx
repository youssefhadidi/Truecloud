/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { Plyr } from 'plyr-react';
import 'plyr-react/plyr.css';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { FiArrowLeft, FiChevronRight, FiVideo, FiFileText, FiMaximize2, FiMinimize2, FiImage, FiMusic, FiBox, FiFile } from 'react-icons/fi';
import Viewer3D, { is3dFile } from './Viewer3D';
import XlsxViewer from './XlsxViewer';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';
import { useShareThumbnail, useThumbnail } from '@/lib/api/files';

function useShareAwareThumbnail(file, currentPath, enabled, shareToken, sharePassword) {
  const authenticated = useThumbnail(file.id, currentPath, enabled && !shareToken);
  const shared = useShareThumbnail(shareToken, file.name, currentPath, sharePassword, enabled && !!shareToken);
  return shareToken ? shared : authenticated;
}

// Preview shown in the main area (while scrolling strip) or in peek panels (prev/next)
function PendingPreview({ file, currentPath, compact = false, shareToken, sharePassword }) {
  const fileType = (() => {
    if (is3dFile(file.name)) return '3d';
    if (isImage(file.name)) return 'image';
    if (isVideo(file.name)) return 'video';
    if (isAudio(file.name)) return 'audio';
    if (isPdf(file.name)) return 'pdf';
    if (isXlsx(file.name)) return 'xlsx';
    return null;
  })();

  const canThumbnail = fileType === 'image' || fileType === 'video' || fileType === 'pdf';
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail, shareToken, sharePassword);
  const hasThumbnail = canThumbnail && thumbnailData?.data;

  const iconSize = compact ? 28 : 64;
  const iconMap = {
    '3d': <FiBox size={iconSize} className="text-orange-400" />,
    video: <FiVideo size={iconSize} className="text-blue-400" />,
    audio: <FiMusic size={iconSize} className="text-purple-400" />,
    pdf: <FiFileText size={iconSize} className="text-red-400" />,
    xlsx: <FiFile size={iconSize} className="text-green-400" />,
    image: <FiImage size={iconSize} className="text-green-400" />,
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-900">
      {hasThumbnail ? (
        <img src={thumbnailData.data} alt={file.name} className="w-full h-full object-contain" draggable={false} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {iconMap[fileType] || <FiFile size={iconSize} className="text-gray-500" />}
          {!compact && <p className="text-gray-300 text-sm truncate max-w-[300px]">{file.name}</p>}
        </div>
      )}
    </div>
  );
}

// Image with thumbnail placeholder — shows thumbnail immediately, fades in full-res on load
function ImageWithThumbnail({ file, currentPath, getFileUrl, shareToken, sharePassword }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const canThumbnail = isImage(file.name) || isVideo(file.name) || isPdf(file.name);
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail, shareToken, sharePassword);
  const hasThumbnail = canThumbnail && thumbnailData?.data;

  // Reset when file changes
  useEffect(() => {
    setFullLoaded(false);
  }, [file.id]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
      {/* Thumbnail as placeholder */}
      {hasThumbnail && !fullLoaded && <img src={thumbnailData.data} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />}
      {/* Full-res image on top */}
      <img
        src={getFileUrl(file, 'image')}
        alt={file.name}
        className={`w-full h-full object-contain transition-opacity duration-300 ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={(e) => {
          setFullLoaded(true);
        }}
        onError={() => setFullLoaded(true)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// Thumbnail item component — lazy-loads thumbnail only when scrolled into view
function ThumbnailItem({ file, currentPath, isActive, onClick, shareToken, sharePassword }) {
  const itemRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fileType = (() => {
    if (is3dFile(file.name)) return '3d';
    if (isImage(file.name)) return 'image';
    if (isVideo(file.name)) return 'video';
    if (isAudio(file.name)) return 'audio';
    if (isPdf(file.name)) return 'pdf';
    if (isXlsx(file.name)) return 'xlsx';
    return null;
  })();

  const canThumbnail = fileType === 'image' || fileType === 'video' || fileType === 'pdf';
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail && isVisible, shareToken, sharePassword);

  const iconMap = {
    '3d': <FiBox size={20} className="text-orange-400" />,
    video: <FiVideo size={20} className="text-blue-400" />,
    audio: <FiMusic size={20} className="text-purple-400" />,
    pdf: <FiFileText size={20} className="text-red-400" />,
    xlsx: <FiFile size={20} className="text-green-400" />,
    image: <FiImage size={20} className="text-green-400" />,
  };

  const hasThumbnail = canThumbnail && thumbnailData?.data;

  return (
    <button
      ref={itemRef}
      onClick={onClick}
      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
        isActive ? 'border-blue-500 ring-2 ring-blue-500/40 scale-105' : 'border-gray-700 hover:border-gray-500'
      } bg-gray-800 flex items-center justify-center`}
      title={file.name}
    >
      {hasThumbnail ? (
        <img src={thumbnailData.data} alt={file.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        iconMap[fileType] || <FiFile size={20} className="text-gray-500" />
      )}
    </button>
  );
}

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate, onSelectFile, shareToken, sharePassword }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const stripRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  // plyr-react does not require refs for player instance
  const isShareMode = !!shareToken;
  // For image zoom reset
  const transformRef = useRef();

  // Helper to build download URL
  const getFileUrl = (file, type) => {
    if (isShareMode) {
      const params = new URLSearchParams();
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      if (sharePassword) {
        params.append('pwd', sharePassword);
      }
      if (type === 'image') {
        params.append('file', filePath);
        params.append('quality', '85');
        params.append('w', '2000');
        params.append('h', '2000');
        return `/api/public/${shareToken}/optimize-image?${params.toString()}`;
      }
      params.append('path', filePath);
      // For share mode, use public API endpoints
      return `/api/public/${shareToken}/download?${params.toString()}`;
    }

    // Use optimization endpoint for all images
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
  }, [viewerFile?.id]);

  // Find the file whose thumbnail is closest to the strip center
  const getCenteredFile = () => {
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
  };

  // Handle strip scroll - change viewed file when scrolling settles
  const handleStripScroll = () => {
    if (programmaticScrollRef.current) return;

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      const centeredFile = getCenteredFile();
      if (centeredFile && centeredFile.id !== viewerFile?.id) {
        onSelectFile(centeredFile);
      }
    }, 150);
  };

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

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
  }, [viewerFile, viewableFiles]);

  // Reset zoom when image changes
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.resetTransform && transformRef.current.resetTransform();
    }
  }, [viewerFile?.id]);

  // Save fullscreen state to localStorage
  const toggleFullscreen = () => {
    const newState = !isFullscreen;
    setIsFullscreen(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mediaViewerFullscreen', JSON.stringify(newState));
    }
  };

  const fileType = viewerFile ? getFileType(viewerFile) : null;
  const effectiveFullscreen = isMobile || isFullscreen;

  // Compute navigation state
  const currentIndex = viewerFile ? viewableFiles.findIndex((f) => f.id === viewerFile.id) : -1;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < viewableFiles.length - 1;

  // plyr-react does not require manual setup/teardown

  if (!viewerFile) return null;

  // Render media based on type
  const renderMedia = () => {
    const stopProp = (e) => e.stopPropagation();

    switch (fileType) {
      case '3d':
        return <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />;

      case 'image':
        return (
          <TransformWrapper
          key={viewerFile.id}
            minScale={0.5}
            maxScale={4}
            initialScale={1}
            centerOnInit={false}
          >
            <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
              <ImageWithThumbnail
                file={viewerFile}
                currentPath={currentPath}
                getFileUrl={getFileUrl}
                shareToken={shareToken}
                sharePassword={sharePassword}
              
              />
            </TransformComponent>
          </TransformWrapper>
        );


      case 'video':
        return (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <div className="w-full h-full max-h-full max-w-full">
              <Plyr
                source={{
                  type: 'video',
                  sources: [
                    {
                      src: getFileUrl(viewerFile, 'video'),
                      type: 'video/mp4',
                    },
                  ],
                }}
                options={{
                  controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
                  autoplay: true,
                }}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        );

      case 'audio':
        return (
          <Plyr
            source={{
              type: 'audio',
              sources: [
                {
                  src: getFileUrl(viewerFile, 'audio'),
                  type: 'audio/mp3',
                },
              ],
            }}
            options={{
              controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'settings'],
              autoplay: true,
            }}
            className="w-full"
          />
        );

      case 'pdf':
        return <iframe src={getFileUrl(viewerFile, 'pdf')} className="w-full h-full" title={viewerFile.name} onClick={stopProp} />;

      case 'xlsx':
        return <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />;

      default:
        return <div className="text-gray-400">Unsupported file type</div>;
    }
  };

  return (
    <div
      className={`${effectiveFullscreen ? 'fixed inset-0 z-50' : 'fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-1'}`}
      onClick={effectiveFullscreen ? null : onClose}
    >
      <div
        className={`${effectiveFullscreen ? 'w-full h-full rounded-none' : 'relative bg-gray-900 rounded-lg shadow-xl w-full max-w-[1600px] h-[90vh]'} bg-gray-900 flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{viewerFile.name}</h3>
            {viewableFiles.length > 1 && (
              <p className="text-gray-400">
                {currentIndex + 1} / {viewableFiles.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700">
            {!isMobile && (
              <button
                onClick={toggleFullscreen}
                className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md border-r border-gray-700 last:border-r-0"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <FiMinimize2 size={18} /> : <FiMaximize2 size={18} />}
              </button>
            )}
            <button onClick={onClose} className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md" title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Media Content */}
        <div className="flex-1 overflow-hidden flex items-center justify-center relative select-none">
          <div className="w-full h-full flex items-center justify-center p-1">{renderMedia()}</div>

          {/* Navigation Buttons - Show if multiple viewable files */}
          {viewableFiles.length > 1 && (
            <>
              <button
                onClick={() => onNavigate('prev')}
                disabled={!canGoPrev}
                className="absolute top-1/2 -translate-y-1/2 text-white bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                title="Previous (← key)"
                style={{ zIndex: 50, left: '1rem' }}
              >
                <FiArrowLeft size={24} />
              </button>

              <button
                onClick={() => onNavigate('next')}
                disabled={!canGoNext}
                className="absolute top-1/2 -translate-y-1/2 text-white bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                title="Next (→ key)"
                style={{ zIndex: 50, right: '1rem' }}
              >
                <FiChevronRight size={24} />
              </button>
            </>
          )}
        </div>

        {/* Thumbnail Strip */}
        {viewableFiles.length > 1 && (
          <div
            ref={stripRef}
            className="flex items-center gap-2 px-4 py-3 border-t border-gray-700 bg-gray-900 overflow-x-auto"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onScroll={handleStripScroll}
          >
            {viewableFiles.map((file) => (
              <div key={file.id} data-file-id={file.id} data-active={file.id === viewerFile.id ? 'true' : undefined}>
                <ThumbnailItem
                  file={file}
                  currentPath={currentPath}
                  isActive={file.id === viewerFile.id}
                  onClick={() => onSelectFile(file)}
                  shareToken={shareToken}
                  sharePassword={sharePassword}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
