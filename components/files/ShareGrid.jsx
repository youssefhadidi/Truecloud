/** @format */

'use client';

import { useRef, useMemo, useCallback, useState, useEffect, memo } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import {
  FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2,
  FiPlay, FiMusic, FiFileText, FiPackage, FiCheck,
} from 'react-icons/fi';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx, is3dFile } from '@/lib/clientFileUtils';
import { fileKind, ftClass } from '@/components/files/fileKindUtils';
import { getShareThumbnailUrl } from '@/lib/api/files';

const BREAKPOINT = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

const getColumnsCount = (width) => {
  if (width < BREAKPOINT.sm) return 3;
  if (width < BREAKPOINT.md) return 4;
  if (width < BREAKPOINT.lg) return 5;
  if (width < BREAKPOINT.xl) return 6;
  if (width < BREAKPOINT['2xl']) return 7;
  return 8;
};

const KIND_ICON = {
  folder: FiFolder,
  image:  FiImage,
  video:  FiVideo,
  audio:  FiMusic,
  pdf:    FiFileText,
  doc:    FiFileText,
  sheet:  FiFileText,
  archive: FiPackage,
  '3d':   FiBox,
  text:   FiFile,
};

function KindIcon({ kind, size = 36 }) {
  const Icon = KIND_ICON[kind] || FiFile;
  return <Icon size={size} />;
}

function ShareThumbnail({ token, fileName, currentSubPath, submittedPassword, isVideoFile }) {
  const ref = useRef(null);
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px', threshold: 0.01 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const thumbnailUrl = isInView ? getShareThumbnailUrl(token, fileName, currentSubPath, submittedPassword) : null;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt={fileName}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isLoaded ? 1 : 0, transition: 'opacity 200ms' }}
          onLoad={() => setIsLoaded(true)}
          loading="lazy"
          decoding="async"
        />
      )}
      {!isLoaded && isInView && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2.5px solid var(--border)',
              borderTopColor: 'var(--accent)',
              animation: 'tc-spin 700ms linear infinite',
            }}
          />
        </div>
      )}
      {isVideoFile && isLoaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div
            style={{
              background: 'rgba(15,23,42,.55)',
              borderRadius: 99,
              padding: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FiPlay color="#fff" size={20} />
          </div>
        </div>
      )}
    </div>
  );
}

function iconBtnStyle(color = 'var(--text-2)') {
  return {
    width: 26,
    height: 26,
    borderRadius: 'var(--r-xs)',
    border: 'none',
    cursor: 'pointer',
    background: 'transparent',
    color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 120ms',
    flexShrink: 0,
    fontFamily: 'inherit',
  };
}

function sheetRowStyle(color = 'var(--text-2)') {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '15px 20px',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 15,
    fontFamily: 'inherit',
    textAlign: 'left',
  };
}

const GridItem = memo(
  ({
    item,
    cellWidth,
    containerWidth,
    style,
    gap,
    token,
    currentSubPath,
    submittedPassword,
    allowUploads,
    isDeletingFile,
    isRenamingFile,
    newFileName,
    onNewFileNameChange,
    onCancelRename,
    onConfirmRename,
    onCancelDelete,
    onConfirmDelete,
    processingFile,
    onFileClick,
    onContextMenu,
    onDownload,
    onInitiateRename,
    onInitiateDelete,
    onOpenMediaViewer,
    formatFileSize,
    selectionMode,
    isSelected,
    onToggleSelect,
    shouldShowActions,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
  }) => {
    const kind = fileKind(item);
    const isFolder = item.isDirectory;
    const showThumbnail = !isFolder && (isImage(item.name) || isVideo(item.name) || isPdf(item.name));
    const iconSize = cellWidth > 100 ? 40 : 28;

    const wrapStyle = { ...style, padding: gap / 2 };

    const cardBase = {
      background: 'var(--surface)',
      borderRadius: 'var(--r-lg)',
      border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
      boxShadow: isSelected ? '0 0 0 3px var(--accent-mid)' : 'var(--shadow-sm)',
      cursor: 'pointer',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
      transition: 'all 150ms ease',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: 'relative',
    };

    return (
      <div style={wrapStyle}>
        <div className="tc-grid-wrap" style={{ position: 'relative', height: '100%' }}>
          <div
            className="tc-grid-card"
            style={cardBase}
            onClick={() => {
              if (selectionMode) { onToggleSelect?.(item); return; }
              if (isDeletingFile || isRenamingFile || shouldShowActions(item.name)) return;
              onFileClick(item);
            }}
            onContextMenu={(e) => onContextMenu?.(e, item)}
            onTouchStart={() => { if (!selectionMode) onTouchStart(item); }}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchMove}
          >
            {/* Selection check badge */}
            {selectionMode && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 4,
                  width: 22,
                  height: 22,
                  borderRadius: 99,
                  background: isSelected ? 'var(--accent)' : 'var(--surface)',
                  border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border-strong)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
                onClick={(e) => { e.stopPropagation(); onToggleSelect?.(item); }}
              >
                {isSelected && <FiCheck size={12} color="#fff" />}
              </div>
            )}

            {/* Delete / rename inline overlays */}
            {isDeletingFile ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'color-mix(in oklab, var(--danger) 18%, var(--surface))',
                  borderRadius: 'inherit',
                  zIndex: 5,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', textAlign: 'center' }}>
                  Delete {item.isDirectory ? 'folder' : 'file'}?
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >Cancel</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: 'var(--danger)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 600,
                    }}
                  >Delete</button>
                </div>
              </div>
            ) : isRenamingFile ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'color-mix(in oklab, var(--accent) 14%, var(--surface))',
                  borderRadius: 'inherit',
                  zIndex: 5,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => onNewFileNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onConfirmRename();
                    if (e.key === 'Escape') onCancelRename();
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCancelRename(); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >Cancel</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfirmRename(); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 600,
                    }}
                  >Rename</button>
                </div>
              </div>
            ) : null}

            {/* Thumbnail */}
            <div
              className={ftClass(item)}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                cursor: selectionMode || isViewableFile(item) ? 'pointer' : 'default',
              }}
              onClick={(e) => {
                if (selectionMode) {
                  e.stopPropagation();
                  onToggleSelect?.(item);
                  return;
                }
                if (isViewableFile(item)) {
                  e.stopPropagation();
                  onOpenMediaViewer(item);
                }
              }}
            >
              {processingFile === item.name && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 3,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      border: '3px solid rgba(255,255,255,.3)',
                      borderTopColor: '#fff',
                      borderRadius: 99,
                      animation: 'tc-spin 700ms linear infinite',
                    }}
                  />
                </div>
              )}

              {showThumbnail ? (
                <ShareThumbnail
                  token={token}
                  fileName={item.name}
                  currentSubPath={currentSubPath}
                  submittedPassword={submittedPassword}
                  isVideoFile={isVideo(item.name)}
                />
              ) : (
                <KindIcon kind={kind} size={iconSize} />
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 56 }}>
              <div
                title={item.name}
                className="tc-truncate"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
              >
                {item.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 'auto' }}>
                {item.isDirectory ? 'Folder' : formatFileSize(item.size)}
              </div>
            </div>
          </div>

          {/* Desktop hover icon bar */}
          {!selectionMode && containerWidth >= BREAKPOINT.sm && !isDeletingFile && !isRenamingFile && (
            <div
              className="tc-grid-actions"
              style={{
                position: 'absolute',
                top: gap / 2 + 8,
                right: gap / 2 + 8,
                display: 'flex',
                gap: 4,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                boxShadow: 'var(--shadow-md)',
                padding: 3,
                zIndex: 6,
                opacity: 0,
                transition: 'opacity 120ms',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {isViewableFile(item) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenMediaViewer(item); }}
                  title="View"
                  disabled={processingFile === item.name}
                  style={iconBtnStyle('var(--accent)')}
                >
                  {is3dFile(item.name) ? <FiBox size={14} />
                  : isVideo(item.name) ? <FiVideo size={14} />
                  : isImage(item.name) ? <FiImage size={14} />
                  : isAudio(item.name) ? <FiMusic size={14} />
                  : isPdf(item.name) ? <FiFileText size={14} />
                  : isXlsx(item.name) ? <FiFileText size={14} />
                  : <FiFile size={14} />}
                </button>
              )}
              {allowUploads && (
                <button
                  onClick={(e) => { e.stopPropagation(); onInitiateRename(item); }}
                  title="Rename"
                  disabled={processingFile === item.name}
                  style={iconBtnStyle('var(--accent)')}
                >
                  <FiEdit size={14} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(item); }}
                title="Download"
                disabled={processingFile === item.name}
                style={iconBtnStyle('var(--accent)')}
              >
                <FiDownload size={14} />
              </button>
              {allowUploads && (
                <button
                  onClick={(e) => { e.stopPropagation(); onInitiateDelete(item); }}
                  title="Delete"
                  disabled={processingFile === item.name}
                  style={iconBtnStyle('var(--danger)')}
                >
                  <FiTrash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

GridItem.displayName = 'ShareGridItem';

function ShareGrid({
  files = [],
  token,
  submittedPassword = '',
  currentSubPath = '',
  allowUploads = false,
  deletingFile,
  renamingFile,
  newFileName,
  onNewFileNameChange,
  onCancelRename,
  onConfirmRename,
  onCancelDelete,
  onConfirmDelete,
  processingFile,
  onFileClick,
  onContextMenu,
  onDownload,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
  selectionMode,
  selectedFiles,
  onToggleSelect,
}) {
  const gridRef = useRef(null);
  const containerWidthRef = useRef(0);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const longPressTimerRef = useRef(null);

  useEffect(() => {
    if (!showingActionsFor) return;
    const prevent = (e) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    return () => document.removeEventListener('touchmove', prevent);
  }, [showingActionsFor]);

  const handleTouchStart = useCallback((item) => {
    longPressTimerRef.current = setTimeout(() => setShowingActionsFor(item.name), 500);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);
  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const shouldShowActions = useCallback(
    (itemName) => {
      if (deletingFile?.name || renamingFile?.name) return false;
      return showingActionsFor === itemName;
    },
    [deletingFile, renamingFile, showingActionsFor],
  );

  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style, parent }) => {
      const containerWidth = parent.props.width;
      const columns = getColumnsCount(containerWidth);
      const gap = containerWidth < BREAKPOINT.sm ? 4 : 12;
      const itemIndex = rowIndex * columns + columnIndex;
      const item = files[itemIndex];
      if (!item) return <div key={key} style={style} />;
      const cellWidth = style.width - gap;
      return (
        <GridItem
          key={key}
          item={item}
          cellWidth={cellWidth}
          containerWidth={containerWidth}
          style={style}
          gap={gap}
          token={token}
          currentSubPath={currentSubPath}
          submittedPassword={submittedPassword}
          allowUploads={allowUploads}
          isDeletingFile={deletingFile?.name === item.name}
          isRenamingFile={renamingFile?.name === item.name}
          newFileName={newFileName}
          onNewFileNameChange={onNewFileNameChange}
          onCancelRename={onCancelRename}
          onConfirmRename={onConfirmRename}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          processingFile={processingFile}
          onFileClick={onFileClick}
          onContextMenu={onContextMenu}
          onDownload={onDownload}
          onInitiateRename={onInitiateRename}
          onInitiateDelete={onInitiateDelete}
          onOpenMediaViewer={onOpenMediaViewer}
          formatFileSize={formatFileSize}
          selectionMode={selectionMode}
          isSelected={!!selectedFiles?.has(item.name)}
          onToggleSelect={onToggleSelect}
          shouldShowActions={shouldShowActions}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        />
      );
    },
    [
      files, token, currentSubPath, submittedPassword, allowUploads,
      deletingFile, renamingFile, newFileName, onNewFileNameChange,
      onCancelRename, onConfirmRename, onCancelDelete, onConfirmDelete,
      processingFile, onFileClick, onContextMenu, onDownload, onInitiateRename,
      onInitiateDelete, onOpenMediaViewer, formatFileSize, selectionMode,
      selectedFiles, onToggleSelect, shouldShowActions,
      handleTouchStart, handleTouchEnd, handleTouchMove,
    ],
  );

  const activeItem = showingActionsFor ? files.find((i) => i.name === showingActionsFor) : null;
  const activeKind = activeItem ? fileKind(activeItem) : null;

  return (
    <div style={{ width: '100%', height: '100%', WebkitOverflowScrolling: 'touch', padding: 4 }}>
      <AutoSizer>
        {({ height, width }) => {
          containerWidthRef.current = width;
          const columns = getColumnsCount(width);
          const cellSize = Math.floor(width / columns);
          const textHeight = 64;
          const rowHeight = cellSize + textHeight;
          const rowCount = Math.ceil(files.length / columns);
          return (
            <Grid
              ref={gridRef}
              cellRenderer={(props) => cellRenderer({ ...props, parent: { props: { width } } })}
              columnCount={columns}
              columnWidth={cellSize}
              height={height}
              rowCount={rowCount}
              rowHeight={rowHeight}
              width={width}
              overscanRowCount={5}
              style={{ outline: 'none', overflowX: 'hidden' }}
            />
          );
        }}
      </AutoSizer>

      {activeItem && !selectionMode && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)' }}
            onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setShowingActionsFor(null); }}
          />
          <div
            className="tc-anim-sheet"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1001,
              background: 'var(--surface)',
              borderRadius: '18px 18px 0 0',
              boxShadow: '0 -4px 32px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--border-strong)' }} />
            </div>
            <div style={{ padding: '6px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <KindIcon kind={activeKind} size={20} />
              <span className="tc-truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
                {activeItem.name}
              </span>
            </div>
            {isViewableFile(activeItem) && (
              <button onClick={() => { setShowingActionsFor(null); onOpenMediaViewer(activeItem); }} style={sheetRowStyle()}>
                {is3dFile(activeItem.name) ? <FiBox size={18} /> : isVideo(activeItem.name) ? <FiVideo size={18} /> : isImage(activeItem.name) ? <FiImage size={18} /> : isAudio(activeItem.name) ? <FiMusic size={18} /> : <FiFileText size={18} />}
                <span>View</span>
              </button>
            )}
            {allowUploads && (
              <button onClick={() => { setShowingActionsFor(null); onInitiateRename(activeItem); }} style={sheetRowStyle()}>
                <FiEdit size={18} /><span>Rename</span>
              </button>
            )}
            <button onClick={() => { setShowingActionsFor(null); onDownload(activeItem); }} style={sheetRowStyle()}>
              <FiDownload size={18} /><span>Download</span>
            </button>
            {allowUploads && (
              <button onClick={() => { setShowingActionsFor(null); onInitiateDelete(activeItem); }} style={sheetRowStyle('var(--danger)')}>
                <FiTrash2 size={18} /><span>Delete</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default memo(ShareGrid);
