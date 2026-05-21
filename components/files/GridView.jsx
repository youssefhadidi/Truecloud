/** @format */

'use client';

import { useRef, useMemo, useCallback, useState, useEffect, memo, forwardRef, useImperativeHandle } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import {
  FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2,
  FiPlay, FiShare2, FiMusic, FiFileText, FiPackage, FiCheck, FiStar,
} from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx, is3dFile } from '@/lib/clientFileUtils';
import DownloadCard from '@/components/files/DownloadCard';
import { fileKind, ftClass } from '@/components/files/fileKindUtils';

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

const GridItem = memo(
  ({
    item,
    cellWidth,
    containerWidth,
    style,
    gap,
    isCreating,
    newFolderName,
    onNewFolderNameChange,
    onCancelCreateFolder,
    onConfirmCreateFolder,
    isDeletingFile,
    isRenamingFile,
    newFileName,
    onNewFileNameChange,
    onCancelRename,
    onConfirmRename,
    isProcessing,
    currentPath,
    onNavigateToFolder,
    onOpenMediaViewer,
    onInitiateRename,
    onHandleDownload,
    onInitiateDelete,
    onConfirmDelete,
    onCancelDelete,
    formatFileSize,
    onInitiateShare,
    sharedPath,
    onContextMenu,
    selectionMode,
    isSelected,
    onToggleSelect,
    showActions,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onPauseDownload,
    onResumeDownload,
    onRemoveDownload,
    isGlobalSearch,
    isFavorite,
  }) => {
    const kind = fileKind(item);
    const isFolder = item.isDirectory;
    const showThumbnail = !isFolder && (isImage(item.name) || isVideo(item.name) || isPdf(item.name));
    const iconSize = cellWidth > 100 ? 40 : 28;

    const wrapStyle = {
      ...style,
      padding: gap / 2,
    };

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
        {isCreating ? (
          <div
            style={{
              ...cardBase,
              border: '1.5px dashed var(--accent)',
              boxShadow: 'none',
              padding: 12,
              alignItems: 'stretch',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirmCreateFolder();
                if (e.key === 'Escape') onCancelCreateFolder();
              }}
              autoFocus
              onFocus={(e) => e.target.select()}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelCreateFolder(); }}
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
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onConfirmCreateFolder(); }}
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
              >
                Create
              </button>
            </div>
          </div>
        ) : item.isDownloading ? (
          <div style={{ width: '100%', height: '100%' }}>
            <DownloadCard
              gid={item.downloadGid}
              initialData={{
                name: item.name,
                path: item.id?.replace('dl-', '') || '',
                progress: item.downloadProgress || 0,
                status: item.downloadStatus || 'active',
                downloadSpeed: item.downloadSpeed || '0 B/s',
                uploadSpeed: item.uploadSpeed || '0 B/s',
                seeders: item.seeders || 0,
                peers: item.peers || 0,
                isTorrent: item.isTorrent || false,
                error: item.error || null,
              }}
              onPause={onPauseDownload}
              onResume={onResumeDownload}
              onRemove={onRemoveDownload}
            />
          </div>
        ) : (
          <div
            className="tc-grid-card"
            style={cardBase}
            onClick={(e) => {
              const ctrl = e.ctrlKey || e.metaKey;
              const shift = e.shiftKey;
              if (ctrl || shift) { e.preventDefault(); onToggleSelect?.(item, { ctrl, shift }); return; }
              if (selectionMode) { onToggleSelect?.(item); return; }
              if (item.isDirectory && !isDeletingFile && !showActions) {
                onNavigateToFolder(item.name, item);
              } else if (isGlobalSearch && !item.isDirectory && !isDeletingFile && !showActions) {
                onNavigateToFolder(item.name, item);
              }
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

            {sharedPath && (
              <div
                title="Shared"
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  zIndex: 4,
                  background: 'var(--success)',
                  color: '#fff',
                  borderRadius: 99,
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <FiShare2 size={9} />
              </div>
            )}

            {isFavorite && (
              <div
                title="Favorite"
                style={{
                  position: 'absolute',
                  top: 8,
                  left: sharedPath ? 32 : 8,
                  zIndex: 4,
                  background: 'var(--warning)',
                  color: '#fff',
                  borderRadius: 99,
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <FiStar size={10} fill="currentColor" />
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
                const ctrl = e.ctrlKey || e.metaKey;
                const shift = e.shiftKey;
                if (ctrl || shift) {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleSelect?.(item, { ctrl, shift });
                  return;
                }
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
              {isProcessing && (
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
                <>
                  <LazyImage
                    key={item.id}
                    src=""
                    alt={item.name}
                    className=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    isThumbnail={true}
                    fileId={item.id}
                    filePath={item._parentPath != null ? item._parentPath : currentPath}
                    onError={(e) => { if (e?.target) e.target.style.display = 'none'; }}
                  />
                  {isVideo(item.name) && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
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
                </>
              ) : (
                <KindIcon kind={kind} size={iconSize} />
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 56 }}>
              <div
                title={item.displayName || item.name}
                className="tc-truncate"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
              >
                {item.displayName || item.name}
              </div>
              {isGlobalSearch && item._parentPath != null && (
                <div className="tc-truncate" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {item._parentPath || '/'}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 'auto' }}>
                {item.isDirectory ? 'Folder' : formatFileSize(item.size)}
              </div>
            </div>

          </div>
        )}

            {/* Desktop hover icon bar */}
            {!isGlobalSearch && !selectionMode && containerWidth >= BREAKPOINT.sm && !item.isDownloading && !isCreating && (
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
                    disabled={isProcessing}
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
                <button
                  onClick={(e) => { e.stopPropagation(); onInitiateRename(item); }}
                  title="Rename"
                  disabled={isProcessing}
                  style={iconBtnStyle('var(--accent)')}
                >
                  <FiEdit size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onHandleDownload(item.id, item.name); }}
                  title="Download"
                  disabled={isProcessing}
                  style={iconBtnStyle('var(--accent)')}
                >
                  <FiDownload size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onInitiateDelete(item); }}
                  title="Delete"
                  disabled={isProcessing}
                  style={iconBtnStyle('var(--danger)')}
                >
                  <FiTrash2 size={14} />
                </button>
                {onInitiateShare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onInitiateShare(item); }}
                    title="Share"
                    disabled={isProcessing}
                    style={iconBtnStyle('var(--success)')}
                  >
                    <FiShare2 size={14} />
                  </button>
                )}
              </div>
            )}

        </div>
      </div>
    );
  },
);

function iconBtnStyle() {
  return {
    width: 26,
    height: 26,
    borderRadius: 'var(--r-xs)',
    border: 'none',
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--text-2)',
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

GridItem.displayName = 'GridItem';

const GridView = forwardRef(
  (
    {
      files,
      creatingFolder,
      newFolderName,
      onNewFolderNameChange,
      onCancelCreateFolder,
      onConfirmCreateFolder,
      deletingFile,
      renamingFile,
      newFileName,
      onNewFileNameChange,
      onCancelRename,
      onConfirmRename,
      processingFile,
      currentPath,
      onNavigateToFolder,
      onOpenMediaViewer,
      onInitiateRename,
      onHandleDownload,
      onInitiateDelete,
      onConfirmDelete,
      onCancelDelete,
      formatFileSize,
      onInitiateShare,
      sharedPaths,
      favoritePaths,
      onContextMenu,
      selectionMode,
      selectedFiles,
      onToggleSelect,
      onPauseDownload,
      onResumeDownload,
      onRemoveDownload,
      isGlobalSearch,
    },
    ref,
  ) => {
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

    const allItems = useMemo(() => {
      const items = [...files];
      if (creatingFolder) items.unshift({ id: 'new-folder', isCreating: true });
      return items;
    }, [files, creatingFolder]);

    // Refs that cellRenderer reads instead of closing over volatile state. Keeps
    // cellRenderer identity stable across selection / hover / share / typing
    // changes so react-virtualized doesn't recreate the renderer; the
    // gridRef.forceUpdate() effect below tells it when to repaint visible cells.
    const allItemsRef = useRef(allItems);
    const selectedFilesRef = useRef(selectedFiles);
    const processingFileRef = useRef(processingFile);
    const sharedPathsRef = useRef(sharedPaths);
    const favoritePathsRef = useRef(favoritePaths);
    const deletingFileIdRef = useRef(deletingFile?.id);
    const renamingFileIdRef = useRef(renamingFile?.id);
    const showingActionsForRef = useRef(showingActionsFor);
    const newFolderNameRef = useRef(newFolderName);
    const newFileNameRef = useRef(newFileName);

    useEffect(() => { allItemsRef.current = allItems; }, [allItems]);
    useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
    useEffect(() => { processingFileRef.current = processingFile; }, [processingFile]);
    useEffect(() => { sharedPathsRef.current = sharedPaths; }, [sharedPaths]);
    useEffect(() => { favoritePathsRef.current = favoritePaths; }, [favoritePaths]);
    useEffect(() => { deletingFileIdRef.current = deletingFile?.id; }, [deletingFile]);
    useEffect(() => { renamingFileIdRef.current = renamingFile?.id; }, [renamingFile]);
    useEffect(() => { showingActionsForRef.current = showingActionsFor; }, [showingActionsFor]);
    useEffect(() => { newFolderNameRef.current = newFolderName; }, [newFolderName]);
    useEffect(() => { newFileNameRef.current = newFileName; }, [newFileName]);

    useEffect(() => {
      gridRef.current?.forceUpdate();
    }, [selectedFiles, processingFile, sharedPaths, favoritePaths, deletingFile, renamingFile, showingActionsFor, newFolderName, newFileName, allItems]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToFile: (fileName) => {
          const index = allItemsRef.current.findIndex((f) => f.name === fileName);
          if (index >= 0 && gridRef.current && containerWidthRef.current) {
            const columns = getColumnsCount(containerWidthRef.current);
            const rowIndex = Math.floor(index / columns);
            const columnIndex = index % columns;
            gridRef.current.scrollToCell({ columnIndex, rowIndex });
          }
        },
      }),
      [],
    );

    const handleTouchStart = useCallback((item) => {
      longPressTimerRef.current = setTimeout(() => setShowingActionsFor(item.id), 500);
    }, []);
    const handleTouchEnd = useCallback(() => {
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    }, []);
    const handleTouchMove = useCallback(() => {
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    }, []);

    const cellRenderer = useCallback(
      ({ columnIndex, key, rowIndex, style }) => {
        const containerWidth = containerWidthRef.current;
        const columns = getColumnsCount(containerWidth);
        const gap = containerWidth < BREAKPOINT.sm ? 3 : 8;
        const itemIndex = rowIndex * columns + columnIndex;
        const item = allItemsRef.current[itemIndex];
        if (!item) return <div key={key} style={style} />;
        const cellWidth = style.width - gap;
        const pathKey = (currentPath ? `${currentPath}/${item.name}` : item.name)
          .replace(/\/+/g, '/')
          .replace(/^\//, '');
        const isShared = sharedPathsRef.current?.has(pathKey) ?? false;
        const isFavorite = favoritePathsRef.current?.has(pathKey) ?? false;
        const isCreating = item.isCreating;
        const isDeletingThis = deletingFileIdRef.current === item.id;
        const isRenamingThis = renamingFileIdRef.current === item.id;
        const isProcessing = processingFileRef.current === item.id;
        const showActions = !deletingFileIdRef.current && !renamingFileIdRef.current && showingActionsForRef.current === item.id;
        return (
          <GridItem
            key={key}
            item={item}
            cellWidth={cellWidth}
            containerWidth={containerWidth}
            style={style}
            gap={gap}
            isCreating={isCreating}
            newFolderName={isCreating ? newFolderNameRef.current : undefined}
            onNewFolderNameChange={onNewFolderNameChange}
            onCancelCreateFolder={onCancelCreateFolder}
            onConfirmCreateFolder={onConfirmCreateFolder}
            isDeletingFile={isDeletingThis}
            isRenamingFile={isRenamingThis}
            newFileName={isRenamingThis ? newFileNameRef.current : undefined}
            onNewFileNameChange={onNewFileNameChange}
            onCancelRename={onCancelRename}
            onConfirmRename={onConfirmRename}
            isProcessing={isProcessing}
            currentPath={currentPath}
            onNavigateToFolder={onNavigateToFolder}
            onOpenMediaViewer={onOpenMediaViewer}
            onInitiateRename={onInitiateRename}
            onHandleDownload={onHandleDownload}
            onInitiateDelete={onInitiateDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
            formatFileSize={formatFileSize}
            onInitiateShare={onInitiateShare}
            sharedPath={isShared}
            isFavorite={isFavorite}
            onContextMenu={onContextMenu}
            selectionMode={selectionMode}
            isSelected={!!selectedFilesRef.current?.has(item.name)}
            onToggleSelect={onToggleSelect}
            showActions={showActions}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
            onRemoveDownload={onRemoveDownload}
            isGlobalSearch={isGlobalSearch}
          />
        );
      },
      [
        currentPath, selectionMode, isGlobalSearch,
        onNewFolderNameChange, onCancelCreateFolder, onConfirmCreateFolder,
        onNewFileNameChange, onCancelRename, onConfirmRename,
        onNavigateToFolder, onOpenMediaViewer, onInitiateRename, onHandleDownload,
        onInitiateDelete, onConfirmDelete, onCancelDelete, onInitiateShare,
        formatFileSize, onContextMenu, onToggleSelect,
        handleTouchStart, handleTouchEnd, handleTouchMove,
        onPauseDownload, onResumeDownload, onRemoveDownload,
      ],
    );

    const activeItem = showingActionsFor ? allItems.find((i) => i.id === showingActionsFor) : null;
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
            const rowCount = Math.ceil(allItems.length / columns);
            return (
              <Grid
                ref={gridRef}
                cellRenderer={cellRenderer}
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

        {activeItem && !isGlobalSearch && !selectionMode && (
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
                  {activeItem.displayName || activeItem.name}
                </span>
              </div>
              {isViewableFile(activeItem) && (
                <button onClick={() => { setShowingActionsFor(null); onOpenMediaViewer(activeItem); }} style={sheetRowStyle()}>
                  {is3dFile(activeItem.name) ? <FiBox size={18} /> : isVideo(activeItem.name) ? <FiVideo size={18} /> : isImage(activeItem.name) ? <FiImage size={18} /> : isAudio(activeItem.name) ? <FiMusic size={18} /> : <FiFileText size={18} />}
                  <span>View</span>
                </button>
              )}
              <button onClick={() => { setShowingActionsFor(null); onInitiateRename(activeItem); }} style={sheetRowStyle()}>
                <FiEdit size={18} /><span>Rename</span>
              </button>
              <button onClick={() => { setShowingActionsFor(null); onHandleDownload(activeItem.id, activeItem.name); }} style={sheetRowStyle()}>
                <FiDownload size={18} /><span>Download</span>
              </button>
              {onInitiateShare && (
                <button onClick={() => { setShowingActionsFor(null); onInitiateShare(activeItem); }} style={sheetRowStyle()}>
                  <FiShare2 size={18} /><span>Share</span>
                </button>
              )}
              <button onClick={() => { setShowingActionsFor(null); onInitiateDelete(activeItem); }} style={sheetRowStyle('var(--danger)')}>
                <FiTrash2 size={18} /><span>Delete</span>
              </button>
            </div>
          </>
        )}
      </div>
    );
  },
);

GridView.displayName = 'GridView';

export default memo(GridView);
