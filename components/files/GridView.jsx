/** @format */

'use client';

import { useRef, useMemo, useCallback, useState, memo, forwardRef, useImperativeHandle } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import {
  FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2,
  FiPlay, FiShare2, FiMusic, FiFileText, FiPackage, FiCheck,
} from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { is3dFile } from '@/components/files/Viewer3D';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
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
    sharedPath,
    onContextMenu,
    selectionMode,
    isSelected,
    onToggleSelect,
    shouldShowActions,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    setShowingActionsFor,
    onPauseDownload,
    onResumeDownload,
    onRemoveDownload,
    isGlobalSearch,
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
            onClick={() => {
              if (selectionMode) { onToggleSelect?.(item); return; }
              if (item.isDirectory && !isDeletingFile && !shouldShowActions(item.id)) {
                onNavigateToFolder(item.name, item);
              } else if (isGlobalSearch && !item.isDirectory && !isDeletingFile && !shouldShowActions(item.id)) {
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
                cursor: isViewableFile(item) ? 'pointer' : 'default',
              }}
              onClick={(e) => {
                if (isViewableFile(item)) {
                  e.stopPropagation();
                  onOpenMediaViewer(item);
                }
              }}
            >
              {processingFile === item.id && (
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

            {/* Hover/long-press actions */}
            {!isGlobalSearch && !selectionMode && (shouldShowActions(item.id) || containerWidth >= BREAKPOINT.sm) && (
              <div
                className="tc-grid-actions"
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  display: 'flex',
                  gap: 4,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  boxShadow: 'var(--shadow-md)',
                  padding: 3,
                  zIndex: 6,
                  opacity: containerWidth >= BREAKPOINT.sm && !shouldShowActions(item.id) ? 0 : 1,
                  transition: 'opacity 120ms',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {isViewableFile(item) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onOpenMediaViewer(item); }}
                    title="View"
                    disabled={processingFile === item.id}
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
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onInitiateRename(item); }}
                  title="Rename"
                  disabled={processingFile === item.id}
                  style={iconBtnStyle('var(--accent)')}
                >
                  <FiEdit size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onHandleDownload(item.id, item.name); }}
                  title="Download"
                  disabled={processingFile === item.id}
                  style={iconBtnStyle('var(--accent)')}
                >
                  <FiDownload size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onInitiateDelete(item); }}
                  title="Delete"
                  disabled={processingFile === item.id}
                  style={iconBtnStyle('var(--danger)')}
                >
                  <FiTrash2 size={14} />
                </button>
                {onInitiateShare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onInitiateShare(item); }}
                    title="Share"
                    disabled={processingFile === item.id}
                    style={iconBtnStyle('var(--success)')}
                  >
                    <FiShare2 size={14} />
                  </button>
                )}
              </div>
            )}

            {shouldShowActions(item.id) && containerWidth < BREAKPOINT.sm && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 0 }}
                onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); }}
                onTouchEnd={(e) => { e.stopPropagation(); setShowingActionsFor(null); }}
              />
            )}
          </div>
        )}
      </div>
    );
  },
);

function iconBtnStyle(activeColor) {
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

    const allItems = useMemo(() => {
      const items = [...files];
      if (creatingFolder) items.unshift({ id: 'new-folder', isCreating: true });
      return items;
    }, [files, creatingFolder]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToFile: (fileName) => {
          const index = allItems.findIndex((f) => f.name === fileName);
          if (index >= 0 && gridRef.current && containerWidthRef.current) {
            const columns = getColumnsCount(containerWidthRef.current);
            const rowIndex = Math.floor(index / columns);
            const columnIndex = index % columns;
            gridRef.current.scrollToCell({ columnIndex, rowIndex });
          }
        },
      }),
      [allItems],
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

    const shouldShowActions = useCallback(
      (itemId) => {
        if (deletingFile?.id || renamingFile?.id) return false;
        return showingActionsFor === itemId;
      },
      [deletingFile, renamingFile, showingActionsFor],
    );

    const cellRenderer = useCallback(
      ({ columnIndex, key, rowIndex, style, parent }) => {
        const containerWidth = parent.props.width;
        const columns = getColumnsCount(containerWidth);
        const gap = 12;
        const itemIndex = rowIndex * columns + columnIndex;
        const item = allItems[itemIndex];
        if (!item) return <div key={key} style={style} />;
        const cellWidth = style.width - gap;
        const isShared = sharedPaths?.has(`${currentPath}/${item.name}`.replace(/\/+/g, '/').replace(/^\//, ''));
        return (
          <GridItem
            key={key}
            item={item}
            cellWidth={cellWidth}
            containerWidth={containerWidth}
            style={style}
            gap={gap}
            isCreating={item.isCreating}
            newFolderName={newFolderName}
            onNewFolderNameChange={onNewFolderNameChange}
            onCancelCreateFolder={onCancelCreateFolder}
            onConfirmCreateFolder={onConfirmCreateFolder}
            isDeletingFile={deletingFile?.id === item.id}
            isRenamingFile={renamingFile?.id === item.id}
            newFileName={newFileName}
            onNewFileNameChange={onNewFileNameChange}
            onCancelRename={onCancelRename}
            onConfirmRename={onConfirmRename}
            processingFile={processingFile}
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
            onContextMenu={onContextMenu}
            selectionMode={selectionMode}
            isSelected={!!selectedFiles?.has(item.name)}
            onToggleSelect={onToggleSelect}
            shouldShowActions={shouldShowActions}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            setShowingActionsFor={setShowingActionsFor}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
            onRemoveDownload={onRemoveDownload}
            isGlobalSearch={isGlobalSearch}
          />
        );
      },
      [
        allItems, newFolderName, onNewFolderNameChange, onConfirmCreateFolder, onCancelCreateFolder,
        deletingFile, onCancelDelete, onConfirmDelete, renamingFile, newFileName, onNewFileNameChange,
        onConfirmRename, onCancelRename, onNavigateToFolder, processingFile, currentPath,
        onOpenMediaViewer, onInitiateRename, onHandleDownload, onInitiateDelete, onInitiateShare,
        formatFileSize, showingActionsFor, handleTouchStart, handleTouchEnd, handleTouchMove,
        shouldShowActions, sharedPaths, onContextMenu, selectionMode, selectedFiles, onToggleSelect,
        isGlobalSearch, onPauseDownload, onResumeDownload, onRemoveDownload,
      ],
    );

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
      </div>
    );
  },
);

GridView.displayName = 'GridView';

export default GridView;
