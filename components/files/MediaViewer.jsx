/** @format */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiX, FiDownload, FiTrash2, FiChevronLeft, FiChevronRight, FiMaximize2, FiMinimize2, FiMessageSquare } from 'react-icons/fi';
import Confirm from '@/components/Confirm';
import { getFileType } from '@/lib/getFileType';
import { useShareOrDownload } from '@/hooks/useShareOrDownload';
import { appendFolderPinToUrl } from '@/lib/folderPinStore';
import { AudioPlayer } from './viewers/AudioPlayer';
import { isAiSupported } from '@/lib/ai/fileTypes';
import { useComponentsConfig } from '@/lib/api/system';
import AiChatPanel from './AiChatPanel';
import { useTranslation } from '@/components/LanguageProvider';

const VideoPlayer = dynamic(
  () => import('./viewers/VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
  { ssr: false },
);

const ImageViewer = dynamic(
  () => import('./viewers/ImageViewer').then((m) => ({ default: m.ImageViewer })),
  { ssr: false },
);
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
  const { t } = useTranslation();
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card" style={{ flexDirection: 'column', gap: 12, padding: '28px 36px', textAlign: 'center' }}>
        <span className="mv-loader-card__text" style={{ fontWeight: 600, color: 'var(--text)' }}>
          {t('viewer.previewUnavailable')}
        </span>
        <span className="mv-loader-card__text" style={{ fontSize: 12 }}>
          {t('viewer.cannotPreview')}
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
          <FiDownload size={13} /> {t('viewer.downloadFile')}
        </a>
      </div>
    </div>
  );
}

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate, onSelectFile, onDelete, shareToken, sharePassword }) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Deleting is only offered to authenticated users (never share visitors)
  // and only when the host page wires up an onDelete handler.
  const canDelete = !shareToken && typeof onDelete === 'function';
  const touchTimerRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const { data: componentsData } = useComponentsConfig();
  const aiChatEnabled = componentsData?.config?.aiChat ?? false;

  // The AI chat is only available for authenticated users (not share visitors),
  // only for file types Claude can read (images, PDFs, text, xlsx), and only
  // when the admin has enabled the AI Chat feature in /admin/extensions.
  const aiAvailable = !shareToken && aiChatEnabled && viewerFile && isAiSupported(viewerFile.name);
  const aiFilePath = viewerFile
    ? (currentPath ? `${currentPath}/${viewerFile.name}` : viewerFile.name).replace(/\/+/g, '/').replace(/^\//, '')
    : '';

  // Close the chat panel when navigating to a different file
  useEffect(() => {
    setAiOpen(false);
  }, [viewerFile?.id]);

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

      // Authenticated branch. <img src> / <video src> / anchor downloads
      // can't carry the X-Folder-Pins header, so for passcode-locked folders
      // the PIN is embedded as a query param.
      const targetPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      if (type === 'image' || type === 'full') {
        return appendFolderPinToUrl(
          `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=85&w=2000&h=2000`,
          targetPath,
        );
      }
      if (type === 'thumbnail') {
        return appendFolderPinToUrl(
          `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=60&w=400&h=400`,
          targetPath,
        );
      }
      const stage = type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download';
      return appendFolderPinToUrl(
        `/api/files/${stage}/${file.id}?path=${encodeURIComponent(currentPath)}`,
        targetPath,
      );
    },
    [shareToken, sharePassword, currentPath],
  );

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
      // Anchor-tag download path can't carry headers, so attach the folder
      // PIN as a query param when the file lives inside a locked subtree.
      const targetPath = currentPath ? `${currentPath}/${viewerFile.name}` : viewerFile.name;
      downloadUrl = appendFolderPinToUrl(
        `/api/files/download/${viewerFile.id}?path=${encodeURIComponent(currentPath)}`,
        targetPath,
      );
    }
    await handleShareOrDownload(downloadUrl, viewerFile.name);
    setContextMenu(null);
  }, [viewerFile, currentPath, shareToken, sharePassword, handleShareOrDownload]);

  const handleConfirmDelete = useCallback(async () => {
    if (!viewerFile || !canDelete) return;
    setDeleting(true);
    try {
      await onDelete(viewerFile);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }, [viewerFile, canDelete, onDelete]);

  // Drop the delete confirmation when switching to another file.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [viewerFile?.id]);

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

  const deleteConfirmOverlay = canDelete && confirmingDelete ? (
    <div
      className="mv-backdrop"
      style={{ zIndex: 9100, padding: 20 }}
      onClick={() => !deleting && setConfirmingDelete(false)}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '100%' }}>
        <Confirm
          message={t('viewer.confirmDelete', { name: viewerFile.name })}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleConfirmDelete}
          isLoading={deleting}
        />
      </div>
    </div>
  ) : null;

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
              {aiAvailable && (
                <button
                  type="button"
                  className="mv-icon-btn"
                  title={aiOpen ? t('viewer.hideClaude') : t('viewer.askClaude')}
                  onClick={() => setAiOpen((v) => !v)}
                  style={aiOpen ? { color: 'var(--accent)' } : undefined}
                >
                  <FiMessageSquare size={16} />
                </button>
              )}
              <button type="button" className="mv-icon-btn" title={t('common.download')} onClick={handleDownload}>
                <FiDownload size={16} />
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="mv-icon-btn"
                  title={t('common.delete')}
                  onClick={() => setConfirmingDelete(true)}
                  style={{ color: 'var(--danger)' }}
                >
                  <FiTrash2 size={16} />
                </button>
              )}
              {!isMobile && (
                <button type="button" className="mv-icon-btn" title={t('viewer.fullscreen')} onClick={toggleFullscreen}>
                  <FiMaximize2 size={16} />
                </button>
              )}
            </div>
            <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
            <button type="button" className="mv-icon-btn" title={t('common.close')} onClick={onClose}>
              <FiX size={16} />
            </button>
          </div>

          {/* Stage + AI panel row */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'row' }}>
            <div
              className="mv-stage"
              style={{ flex: 1, minWidth: 0 }}
              onContextMenu={handleContextMenu}
              onClick={() => setContextMenu(null)}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="mv-stage__content">{renderMedia()}</div>

              {multi && (
                <>
                  <button
                    type="button"
                    className="mv-nav-btn mv-stage__nav mv-stage__nav--prev"
                    aria-label={t('common.previous')}
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
                    aria-label={t('common.next')}
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

            {aiAvailable && aiOpen && (
              <AiChatPanel
                filePath={aiFilePath}
                fileName={viewerFile.name}
                isMobile={isMobile}
                onClose={() => setAiOpen(false)}
              />
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
          {deleteConfirmOverlay}
        </div>
      </div>
    );
  }

  // Fullscreen mode — same modal layout, full viewport
  return (
    <div className="mv-fullscreen" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
          {aiAvailable && (
            <button
              type="button"
              className="mv-icon-btn"
              title={aiOpen ? t('viewer.hideClaude') : t('viewer.askClaude')}
              onClick={() => setAiOpen((v) => !v)}
              style={aiOpen ? { color: 'var(--accent)' } : undefined}
            >
              <FiMessageSquare size={16} />
            </button>
          )}
          <button type="button" className="mv-icon-btn" title={t('common.download')} onClick={handleDownload}>
            <FiDownload size={16} />
          </button>
          {!isMobile && (
            <button type="button" className="mv-icon-btn" title={t('viewer.exitFullscreen')} onClick={toggleFullscreen}>
              <FiMinimize2 size={16} />
            </button>
          )}
        </div>
        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
        <button type="button" className="mv-icon-btn" title={t('common.close')} onClick={onClose}>
          <FiX size={16} />
        </button>
      </div>

      {/* Stage + AI panel row */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'row' }}>
        <div
          className="mv-stage"
          style={{ flex: 1, minWidth: 0 }}
          onContextMenu={handleContextMenu}
          onClick={() => setContextMenu(null)}
        >
          <div className="mv-stage__content">{renderMedia()}</div>

          {multi && (
            <>
              <button
                type="button"
                className="mv-nav-btn mv-stage__nav mv-stage__nav--prev"
                aria-label={t('common.previous')}
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
                aria-label={t('common.next')}
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

        {aiAvailable && aiOpen && (
          <AiChatPanel
            filePath={aiFilePath}
            fileName={viewerFile.name}
            isMobile={isMobile}
            onClose={() => setAiOpen(false)}
          />
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
      {deleteConfirmOverlay}
    </div>
  );
}
