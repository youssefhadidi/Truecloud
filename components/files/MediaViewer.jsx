/** @format */

'use client';

import { lazy, Suspense, useCallback, useEffect } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { FiArrowLeft, FiChevronRight, FiMaximize2, FiMinimize2 } from 'react-icons/fi';
import { getFileType } from '@/lib/getFileType';
import { VideoPlayer } from './viewers/VideoPlayer';
import { AudioPlayer } from './viewers/AudioPlayer';
import { ImageViewer } from './viewers/ImageViewer';
import { ThumbnailItem } from './ThumbnailItem';
import { useMediaViewerState, useMediaViewerScroll } from './hooks/useMediaViewerState';

// Lazy load heavy viewers
const Viewer3D = lazy(() => import('./Viewer3D').then((m) => ({ default: m.default })));
const XlsxViewer = lazy(() => import('./XlsxViewer'));

function PDFViewer({ file, getFileUrl, onClick }) {
  return <iframe src={getFileUrl(file, 'pdf')} className="w-full h-full" title={file.name} onClick={onClick} />;
}

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate, onSelectFile, shareToken, sharePassword }) {
  const {
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
  } = useMediaViewerState(viewerFile, viewableFiles);

  const { handleStripScroll } = useMediaViewerScroll(stripRef, programmaticScrollRef, viewerFile, viewableFiles, onSelectFile);

  // Helper to build download URL
  const getFileUrl = useCallback(
    (file, type) => {
      if (shareToken) {
        const params = new URLSearchParams();
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        if (sharePassword) {
          params.append('pwd', sharePassword);
        }
        if (type === 'image') {
          params.append('file', filePath);
          params.append('quality', '85');
          params.append('w', '1800');
          params.append('h', '1800');
          return `/api/public/${shareToken}/optimize-image?${params.toString()}`;
        }
        params.append('path', filePath);
        return `/api/public/${shareToken}/download?${params.toString()}`;
      }

      if (type === 'image') {
        return `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=85&w=2000&h=2000`;
      }
      const baseUrl = `/api/files/${type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download'}/${file.id}`;
      return `${baseUrl}?path=${encodeURIComponent(currentPath)}`;
    },
    [shareToken, sharePassword, currentPath],
  );

  // Reset zoom when image changes
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.resetTransform && transformRef.current.resetTransform();
    }
  }, [viewerFile?.id, transformRef]);

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [scrollTimeoutRef]);

  const fileType = viewerFile ? getFileType(viewerFile) : null;

  if (!viewerFile) return null;

  const stopProp = (e) => e.stopPropagation();

  // Render media based on type
  const renderMedia = () => {
    switch (fileType) {
      case '3d':
        return (
          <Suspense fallback={<div className="text-gray-400">Loading 3D viewer...</div>}>
            <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />
          </Suspense>
        );

      case 'image':
        return (
          <TransformWrapper minScale={0.5} maxScale={4} initialScale={0.8} centerOnInit={false} ref={transformRef}>
            <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
              <ImageViewer
                file={viewerFile}
                currentPath={currentPath}
                getFileUrl={getFileUrl}
                shareToken={shareToken}
                sharePassword={sharePassword}
                onImageLoad={(e) => {
                  const img = e.target;
                  const container = img.closest('.w-full.h-full');
                  if (container && transformRef.current && img.naturalWidth && img.naturalHeight) {
                    const containerWidth = container.offsetWidth;
                    const containerHeight = container.offsetHeight;
                    const scale = Math.min(containerWidth / img.naturalWidth, containerHeight / img.naturalHeight) * 0.95;
                    transformRef.current.setInstance?.({ scale });
                  }
                }}
              />
            </TransformComponent>
          </TransformWrapper>
        );

      case 'video':
        return <VideoPlayer file={viewerFile} getFileUrl={getFileUrl} />;

      case 'audio':
        return <AudioPlayer file={viewerFile} getFileUrl={getFileUrl} />;

      case 'pdf':
        return <PDFViewer file={viewerFile} getFileUrl={getFileUrl} onClick={stopProp} />;

      case 'xlsx':
        return (
          <Suspense fallback={<div className="text-gray-400">Loading spreadsheet viewer...</div>}>
            <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />
          </Suspense>
        );

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
            {viewableFiles.length > 1 && <p className="text-gray-400">{currentIndex + 1} / {viewableFiles.length}</p>}
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

          {/* Navigation Buttons */}
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
