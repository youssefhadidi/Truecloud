/** @format */

'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiX, FiDownload, FiTrash2, FiChevronLeft, FiChevronRight, FiMaximize2, FiMinimize2, FiMessageSquare } from 'react-icons/fi';
import Confirm from '@/components/Confirm';
import { getFileType } from '@/lib/getFileType';
import { formatFileSize } from '@/lib/clientFileUtils';
import { useShareOrDownload } from '@/hooks/useShareOrDownload';
import { appendFolderPinToUrl } from '@/lib/folderPinStore';
import { fileVersion } from '@/lib/api/files';
import { VIEWER_IMAGE } from '@/lib/imageVariants.mjs';
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

const TextViewer = dynamic(() => import('./viewers/TextViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card">
        <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
      </div>
    </div>
  ),
});

// pdf.js rather than an <iframe> of the browser's viewer: mobile browsers
// either can't show a PDF in an iframe at all (Android) or show it without
// usable zoom (iOS). Loaded on demand — only PDF opens pay for it.
const PdfViewer = dynamic(() => import('./viewers/PdfViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card">
        <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
      </div>
    </div>
  ),
});

// The image the viewer shows, for both signed-in users and share links. The
// server fits it inside this box and never upscales. Shared with the cache
// worker, which pre-generates exactly this variant.
const { quality: VIEWER_IMAGE_QUALITY, width: VIEWER_IMAGE_WIDTH, height: VIEWER_IMAGE_HEIGHT } = VIEWER_IMAGE;

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

function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate, onSelectFile, onDelete, shareToken, sharePassword }) {
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

  // Share visitors are unauthenticated, so skip the admin-only components
  // request — a 403 there trips the global axios interceptor and force-logs
  // them out. AI chat is gated on !shareToken anyway, so we never need it.
  const { data: componentsData } = useComponentsConfig(!shareToken);
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

  const { isMobile, effectiveFullscreen, toggleFullscreen, stripRef, programmaticScrollRef, currentIndex, canGoPrev, canGoNext } =
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
          const version = fileVersion(file);
          if (version) params.append('v', version);
          params.append('quality', type === 'thumbnail' ? '60' : String(VIEWER_IMAGE_QUALITY));
          if (type === 'thumbnail') {
            params.append('w', '400');
            params.append('h', '400');
          } else {
            params.append('w', String(VIEWER_IMAGE_WIDTH));
            params.append('h', String(VIEWER_IMAGE_HEIGHT));
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
      const version = fileVersion(file);
      const v = version ? `&v=${encodeURIComponent(version)}` : '';
      if (type === 'image' || type === 'full') {
        return appendFolderPinToUrl(
          `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=${VIEWER_IMAGE_QUALITY}&w=${VIEWER_IMAGE_WIDTH}&h=${VIEWER_IMAGE_HEIGHT}${v}`,
          targetPath,
        );
      }
      if (type === 'thumbnail') {
        return appendFolderPinToUrl(
          `/api/files/optimize-image/${encodeURIComponent(file.name)}?path=${encodeURIComponent(currentPath)}&quality=60&w=400&h=400${v}`,
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

  // Warm the cache for the neighbouring images so stepping through a folder
  // shows the next photo at once instead of a blurred placeholder. Delayed a
  // beat so the current file isn't competing with them for bandwidth.
  useEffect(() => {
    if (currentIndex < 0 || !viewableFiles?.length) return undefined;
    const id = setTimeout(() => {
      for (const i of [currentIndex + 1, currentIndex - 1]) {
        const f = viewableFiles[i];
        if (f && getFileType(f) === 'image') new Image().src = getFileUrl(f, 'image');
      }
    }, 400);
    return () => clearTimeout(id);
  }, [currentIndex, viewableFiles, getFileUrl]);

  // Keyboard nav
  useEffect(() => {
    if (!viewerFile) return undefined;
    function onKey(e) {
      const el = e.target instanceof Element ? e.target : null;
      // Typing in a field (the text viewer's search box, the PDF page box)
      // must not page through files or toggle fullscreen.
      const typing = el?.closest('input, textarea, select, [contenteditable="true"]');
      if (typing && e.key !== 'Escape') return;
      if (e.key === 'Escape') {
        if (effectiveFullscreen && !isMobile) toggleFullscreen();
        else onClose?.();
        return;
      }
      // Alt+arrows is browser history; a focused video seeks with the arrows.
      if (e.altKey || e.ctrlKey || e.metaKey || el?.closest('video, audio')) return;
      if (e.key === 'ArrowRight' && canGoNext) onNavigate?.('next');
      if (e.key === 'ArrowLeft' && canGoPrev) onNavigate?.('prev');
      if ((e.key === 'f' || e.key === 'F') && !isMobile) toggleFullscreen();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerFile, effectiveFullscreen, canGoNext, canGoPrev, isMobile, onClose, onNavigate, toggleFullscreen]);

  const handleSwipe = useCallback(
    (direction) => {
      if (direction === 'next' ? canGoNext : canGoPrev) onNavigate?.(direction);
    },
    [canGoNext, canGoPrev, onNavigate],
  );

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

  // A finger that moves is a swipe or a pan, not a long-press.
  const handleTouchMove = useCallback((e) => {
    if (!touchTimerRef.current) return;
    const touch = e.touches[0];
    if (Math.hypot(touch.clientX - touchStartRef.current.x, touch.clientY - touchStartRef.current.y) > 10) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  if (!viewerFile) return null;

  const fileType = getFileType(viewerFile);
  const stopProp = (e) => e.stopPropagation();
  const total = viewableFiles?.length || 0;
  const multi = total > 1;
  const meta = [multi && `${currentIndex + 1} / ${total}`, formatFileSize(viewerFile.size)].filter(Boolean).join(' · ');

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
        return <ImageViewer file={viewerFile} currentPath={currentPath} getFileUrl={getFileUrl} shareToken={shareToken} sharePassword={sharePassword} onSwipe={multi ? handleSwipe : undefined} />;
      case 'video':
        return <VideoPlayer file={viewerFile} getFileUrl={getFileUrl} currentPath={currentPath} shareToken={shareToken} />;
      case 'audio':
        return <AudioPlayer file={viewerFile} getFileUrl={getFileUrl} currentPath={currentPath} shareToken={shareToken} sharePassword={sharePassword} />;
      case 'pdf': {
        // Keyed by URL so every document mounts a fresh viewer (no state
        // carried over from the previous PDF).
        const pdfUrl = getFileUrl(viewerFile, 'pdf');
        return <PdfViewer key={pdfUrl} url={pdfUrl} fileSize={viewerFile.size} onClick={stopProp} />;
      }
      case 'xlsx':
        return <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} shareToken={shareToken} sharePassword={sharePassword} onClick={stopProp} />;
      case 'text':
        return <TextViewer file={viewerFile} getFileUrl={getFileUrl} />;
      default:
        return <UnsupportedViewer file={viewerFile} getFileUrl={getFileUrl} />;
    }
  }

  // Windowed and fullscreen share one layout; only the outer frame differs.
  const content = (
    <>
      <div className="mv-header">
        <div className="mv-header__info">
          <div className="mv-header__title" title={viewerFile.name}>{viewerFile.name}</div>
          {meta && <div className="mv-header__meta">{meta}</div>}
        </div>
        <div className="mv-header__actions">
          {aiAvailable && (
            <button
              type="button"
              className={`mv-icon-btn${aiOpen ? ' mv-icon-btn--active' : ''}`}
              title={aiOpen ? t('viewer.hideClaude') : t('viewer.askClaude')}
              aria-pressed={aiOpen}
              onClick={() => setAiOpen((v) => !v)}
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
              className="mv-icon-btn mv-icon-btn--danger"
              title={t('common.delete')}
              onClick={() => setConfirmingDelete(true)}
            >
              <FiTrash2 size={16} />
            </button>
          )}
          {!isMobile && (
            <button
              type="button"
              className="mv-icon-btn"
              title={effectiveFullscreen ? t('viewer.exitFullscreen') : t('viewer.fullscreen')}
              onClick={toggleFullscreen}
            >
              {effectiveFullscreen ? <FiMinimize2 size={16} /> : <FiMaximize2 size={16} />}
            </button>
          )}
        </div>
        <div className="mv-header__divider" />
        <button type="button" className="mv-icon-btn" title={t('common.close')} onClick={onClose}>
          <FiX size={16} />
        </button>
      </div>

      {/* Stage + AI panel row */}
      <div className="mv-body">
        <div
          className="mv-stage"
          onContextMenu={handleContextMenu}
          onClick={() => setContextMenu(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Keyed by file so each one mounts a fresh viewer (no state carried
              over from the previous file) and fades in. */}
          <div key={viewerFile.id} className="mv-stage__content">
            {renderMedia()}
          </div>

          {multi && (
            <>
              <button
                type="button"
                className="mv-nav-btn mv-stage__nav mv-stage__nav--prev"
                aria-label={t('common.previous')}
                title={t('common.previous')}
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
                title={t('common.next')}
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
    </>
  );

  // Same element tree in both modes, only classes change: switching wrappers
  // would remount the viewer and restart a playing video.
  return (
    <div className={`mv-backdrop${effectiveFullscreen ? ' mv-backdrop--bare' : ''}`} onClick={effectiveFullscreen ? undefined : onClose}>
      <div className={effectiveFullscreen ? 'mv-fullscreen' : 'mv-sheet'} onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}

// Memo'd: the file browser re-renders for reasons unrelated to the open file.
export default memo(MediaViewer);
