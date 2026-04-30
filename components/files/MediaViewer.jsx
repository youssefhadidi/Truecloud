/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiX, FiDownload, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { getFileType } from '@/lib/getFileType';
import { useShareOrDownload } from '@/hooks/useShareOrDownload';
import { VideoPlayer } from './viewers/VideoPlayer';
import { AudioPlayer } from './viewers/AudioPlayer';
import { ImageViewer } from './viewers/ImageViewer';
import ThumbnailStrip from './ThumbnailStrip';
import { useMediaViewerState, useMediaViewerScroll } from './hooks/useMediaViewerState';
import ContextMenu from './ContextMenu';
import './media-viewer.css';

const Viewer3D = dynamic(() => import('./Viewer3D'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card">
        <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
        <span className="mv-loader-card__text">Loading 3D viewer…</span>
      </div>
    </div>
  ),
});
const XlsxViewer = dynamic(() => import('./XlsxViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card">
        <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
        <span className="mv-loader-card__text">Loading spreadsheet viewer…</span>
      </div>
    </div>
  ),
});

function PDFViewer({ file, getFileUrl, onClick }) {
  return (
    <div className="mv-pdf-wrapper">
      <iframe className="mv-pdf-frame" src={getFileUrl(file, 'pdf')} title={file.name} onClick={onClick} />
    </div>
  );
}

function UnsupportedViewer({ file, getFileUrl }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card" style={{ flexDirection: 'column', gap: 12, padding: '28px 36px', textAlign: 'center' }}>
        <span className="mv-loader-card__text" style={{ fontWeight: 600, color: 'var(--text)' }}>
          Preview unavailable
        </span>
        <span className="mv-loader-card__text" style={{ fontSize: 12 }}>
          This file type can&apos;t be previewed in the browser.
        </span>
        <a
          href={getFileUrl(file, 'download')}
          download={file.name}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 'var(--r-sm)',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          <FiDownload size={13} /> Download file
        </a>
      </div>
    </div>
  );
}

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate, onSelectFile, shareToken, sharePassword }) {
  const [contextMenu, setContextMenu] = useState(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const touchTimerRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const { isFullscreen, isMobile, effectiveFullscreen, toggleFullscreen, stripRef, scrollTimeoutRef, programmaticScrollRef, currentIndex, canGoPrev, canGoNext } =
    useMediaViewerState(viewerFile, viewableFiles);

  const { handleStripScroll } = useMediaViewerScroll(stripRef, programmaticScrollRef, viewerFile, viewableFiles, onSelectFile);
  const { handleShareOrDownload } = useShareOrDownload();

  const getFileUrl = useCallback(
    (file, type) => {
      // Public share branch
      if (shareToken) {
        const params = new URLSearchParams();
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        if (sharePassword) params.append('pwd', sharePassword);

        if (type === 'image' || type === 'full' || type === 'thumbnail') {
          params.append('file', filePath);
          params.append('quality', type === 'thumbnail' ? '60' : '85');
          if (type === 'thumbnail') {
            params.append('w', '400');
            params.append('h', '400');
          } else {
            params.append('w', '1800');
            params.append('h', '1800');
          }
          return `/api/public/${shareToken}/optimize-image?${params.toString()}`;
        }
        params.append('path', filePath);
        const endpoint = type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download';
        return `/api/public/${shareToken}/${endpoint}?${params.toString()}`;
      }

      // Authenticated branch
      if (type === 'image' || type === 'full') {
        return `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=85&w=2000&h=2000`;
      }
      if (type === 'thumbnail') {
        return `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=60&w=400&h=400`;
      }
      const stage = type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download';
      return `/api/files/${stage}/${file.id}?path=${encodeURIComponent(currentPath)}`;
    },
    [shareToken, sharePassword, currentPath],
  );

  // Chrome (header / strip / nav buttons) is always visible — no auto-hide.
  const showChrome = useCallback(() => {
    setChromeVisible(true);
  }, []);

  useEffect(() => {
    setChromeVisible(true);
  }, [effectiveFullscreen]);

  // Keyboard nav
  useEffect(() => {
    if (!viewerFile) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (effectiveFullscreen && !isMobile) toggleFullscreen();
        else onClose?.();
      }
      if (e.key === 'ArrowRight' && canGoNext) onNavigate?.('next');
      if (e.key === 'ArrowLeft' && canGoPrev) onNavigate?.('prev');
      if ((e.key === 'f' || e.key === 'F') && !isMobile) toggleFullscreen();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerFile, effectiveFullscreen, canGoNext, canGoPrev, isMobile, onClose, onNavigate, toggleFullscreen]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDownload = useCallback(async () => {
    if (!viewerFile) return;
    let downloadUrl;
    if (shareToken) {
      const params = new URLSearchParams();
      const filePath = currentPath ? `${currentPath}/${viewerFile.name}` : viewerFile.name;
      params.append('path', filePath);
      if (sharePassword) params.append('pwd', sharePassword);
      downloadUrl = `/api/public/${shareToken}/download?${params.toString()}`;
    } else {
      downloadUrl = `/api/files/download/${viewerFile.id}?path=${encodeURIComponent(currentPath)}`;
    }
    await handleShareOrDownload(downloadUrl, viewerFile.name);
    setContextMenu(null);
  }, [viewerFile, currentPath, shareToken, sharePassword, handleShareOrDownload]);

  const handleTouchStart = useCallback((e) => {
    if (e.target.tagName !== 'IMG' && e.target.tagName !== 'CANVAS') return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchTimerRef.current = setTimeout(() => {
      setContextMenu({ x: touch.clientX, y: touch.clientY });
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [scrollTimeoutRef]);

  if (!viewerFile) return null;

  const fileType = getFileType(viewerFile);
  const stopProp = (e) => e.stopPropagation();
  const total = viewableFiles?.length || 0;
  const multi = total > 1;

  function renderMedia() {
    switch (fileType) {
      case '3d':
        return <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />;
      case 'image':
        return <ImageViewer file={viewerFile} currentPath={currentPath} getFileUrl={getFileUrl} shareToken={shareToken} sharePassword={sharePassword} />;
      case 'video':
        return <VideoPlayer file={viewerFile} getFileUrl={getFileUrl} currentPath={currentPath} shareToken={shareToken} />;
      case 'audio':
        return <AudioPlayer file={viewerFile} getFileUrl={getFileUrl} currentPath={currentPath} shareToken={shareToken} sharePassword={sharePassword} />;
      case 'pdf':
        return <PDFViewer file={viewerFile} getFileUrl={getFileUrl} onClick={stopProp} />;
      case 'xlsx':
        return <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />;
      default:
        return <UnsupportedViewer file={viewerFile} getFileUrl={getFileUrl} />;
    }
  }

  // Windowed mode
  if (!effectiveFullscreen) {
    return (
      <div className="mv-backdrop" onClick={onClose}>
        <div className="mv-sheet" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="mv-header">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mv-header__title">{viewerFile.name}</div>
              {multi && (
                <div className="mv-header__counter">
                  {currentIndex + 1} / {total}
                </div>
              )}
            </div>
            <div className="mv-header__actions">
              <button type="button" className="mv-icon-btn" title="Download" onClick={handleDownload}>
                <FiDownload size={16} />
              </button>
              {!isMobile && (
                <button type="button" className="mv-icon-btn" title="Fullscreen" onClick={toggleFullscreen}>
                  <FiMaximize2 size={16} />
                </button>
              )}
            </div>
            <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
            <button type="button" className="mv-icon-btn" title="Close" onClick={onClose}>
              <FiX size={16} />
            </button>
          </div>

          {/* Stage */}
          <div className="mv-stage" onContextMenu={handleContextMenu} onClick={() => setContextMenu(null)} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="mv-stage__content">{renderMedia()}</div>

            {multi && (
              <>
                <button
                  type="button"
                  className="mv-nav-btn mv-stage__nav mv-stage__nav--prev"
                  aria-label="Previous"
                  disabled={!canGoPrev}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.('prev');
                  }}
                >
                  <FiChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="mv-nav-btn mv-stage__nav mv-stage__nav--next"
                  aria-label="Next"
                  disabled={!canGoNext}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.('next');
                  }}
                >
                  <FiChevronRight size={22} />
                </button>
              </>
            )}
          </div>

          {/* Strip */}
          {multi && (
            <ThumbnailStrip
              files={viewableFiles}
              activeId={viewerFile.id}
              currentPath={currentPath}
              shareToken={shareToken}
              sharePassword={sharePassword}
              onSelect={onSelectFile}
              onScroll={handleStripScroll}
              stripRef={stripRef}
            />
          )}

          <ContextMenu contextMenu={contextMenu} file={viewerFile} onDownload={handleDownload} onClose={() => setContextMenu(null)} />
        </div>
      </div>
    );
  }

  // Fullscreen mode (auto-hide chrome)
  return (
    <div
      className="mv-fullscreen"
      onMouseMove={showChrome}
      onTouchStart={(e) => {
        showChrome();
        handleTouchStart(e);
      }}
    >
      {/* Glass header */}
      <div className={`mv-header mv-header--glass mv-chrome${chromeVisible ? '' : ' mv-chrome--hidden'}`}>
        <button type="button" className="mv-icon-btn mv-icon-btn--glass mv-icon-btn--close-glass" title="Close" onClick={onClose}>
          <FiX size={15} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewerFile.name}</div>
          {multi && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
              {currentIndex + 1} / {total}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="mv-icon-btn mv-icon-btn--glass" title="Download" onClick={handleDownload}>
            <FiDownload size={15} />
          </button>
          {!isMobile && (
            <button type="button" className="mv-icon-btn mv-icon-btn--glass" title="Exit fullscreen" onClick={toggleFullscreen}>
              <FiMinimize2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div
        className="mv-stage"
        onContextMenu={handleContextMenu}
        onClick={() => setContextMenu(null)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ background: '#000' }}
      >
        <div className="mv-stage__content">{renderMedia()}</div>

        {multi && (
          <>
            <button
              type="button"
              className={`mv-nav-btn mv-nav-btn--glass mv-stage__nav mv-stage__nav--prev mv-chrome${chromeVisible ? '' : ' mv-chrome--hidden'}`}
              aria-label="Previous"
              disabled={!canGoPrev}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.('prev');
              }}
            >
              <FiChevronLeft size={22} />
            </button>
            <button
              type="button"
              className={`mv-nav-btn mv-nav-btn--glass mv-stage__nav mv-stage__nav--next mv-chrome${chromeVisible ? '' : ' mv-chrome--hidden'}`}
              aria-label="Next"
              disabled={!canGoNext}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.('next');
              }}
            >
              <FiChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {/* Strip (auto-hide) */}
      {multi && (
        <div className={`mv-chrome${chromeVisible ? '' : ' mv-chrome--hidden'}`}>
          <ThumbnailStrip
            files={viewableFiles}
            activeId={viewerFile.id}
            currentPath={currentPath}
            shareToken={shareToken}
            sharePassword={sharePassword}
            onSelect={onSelectFile}
            onScroll={handleStripScroll}
            stripRef={stripRef}
            glass
          />
        </div>
      )}

      <ContextMenu contextMenu={contextMenu} file={viewerFile} onDownload={handleDownload} onClose={() => setContextMenu(null)} />
    </div>
  );
}
