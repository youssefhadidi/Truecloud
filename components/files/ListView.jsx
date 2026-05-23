/** @format */

'use client';

import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle, useMemo, memo } from 'react';
import { List, AutoSizer } from 'react-virtualized';
import {
  FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2, FiLock,
  FiShare2, FiMusic, FiFileText, FiPackage, FiCheck, FiStar,
} from 'react-icons/fi';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx, is3dFile } from '@/lib/clientFileUtils';
import { ListDownloadRow } from '@/components/files/ListDownloadRow';
import { fileKind, ftClass } from '@/components/files/fileKindUtils';

const MOBILE_BREAKPOINT = 768;

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

function ThumbBadge({ file }) {
  const Icon = KIND_ICON[fileKind(file)] || FiFile;
  return (
    <div
      className={ftClass(file)}
      style={{
        width: 32,
        height: 32,
        borderRadius: 'var(--r-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon size={15} />
    </div>
  );
}

function actionBtn({ color = 'var(--text-2)' } = {}) {
  return {
    width: 28,
    height: 28,
    borderRadius: 'var(--r-xs)',
    border: 'none',
    cursor: 'pointer',
    background: 'transparent',
    color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 120ms',
    fontFamily: 'inherit',
  };
}

// Memo'd normal-row component. Only re-renders when its own props change, so
// selection clicks repaint just the row(s) whose isSelected actually flipped
// instead of every visible row.
const ListRow = memo(function ListRow({
  file,
  style,
  isMobile,
  gridCols,
  isGlobalSearch,
  selectionMode,
  isSelected,
  isShared,
  isFavorite,
  isProcessing,
  showActions,
  formatFileSize,
  onClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onToggleSelect,
  onOpenMediaViewer,
  onInitiateRename,
  onHandleDownload,
  onInitiateDelete,
  onInitiateShare,
  onClearActions,
}) {
  return (
    <div
      className="tc-list-row"
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: isMobile ? 8 : 16,
        padding: isMobile ? '6px 12px' : '8px 24px',
        background: isSelected ? 'var(--accent-light)' : 'transparent',
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background 120ms',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {selectionMode && (
          <div
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(file); }}
            style={{
              width: 18,
              height: 18,
              borderRadius: 99,
              border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: isSelected ? 'var(--accent)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms',
              flexShrink: 0,
            }}
          >
            {isSelected && <FiCheck size={10} color="#fff" />}
          </div>
        )}
        {isProcessing ? (
          <div
            style={{
              width: 18,
              height: 18,
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: 99,
              animation: 'tc-spin 700ms linear infinite',
              flexShrink: 0,
            }}
          />
        ) : (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <ThumbBadge file={file} />
            {isShared && (
              <div
                title="Shared"
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: 'var(--success)',
                  color: '#fff',
                  borderRadius: 99,
                  width: 14,
                  height: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <FiShare2 size={7} />
              </div>
            )}
            {isFavorite && (
              <div
                title="Favorite"
                style={{
                  position: 'absolute',
                  top: -4,
                  left: -4,
                  background: 'var(--warning)',
                  color: '#fff',
                  borderRadius: 99,
                  width: 14,
                  height: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <FiStar size={8} fill="currentColor" />
              </div>
            )}
          </div>
        )}
        <span
          className="tc-truncate"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: file.isDirectory ? 'var(--accent)' : 'var(--text)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title={file.displayName || file.name}
        >
          {file.locked && <FiLock size={12} color="var(--warning)" title="Passcode-locked" />}
          {file.displayName || file.name}
        </span>
      </div>

      {!isMobile && (
        isGlobalSearch ? (
          <div className="tc-truncate" style={{ fontSize: 12, color: 'var(--text-3)' }} title={file._parentPath || '/'}>
            {file._parentPath || '/'}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {file.isDirectory ? '—' : formatFileSize(file.size)}
          </div>
        )
      )}
      {!isMobile && !isGlobalSearch && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : ''}
        </div>
      )}

      {!isGlobalSearch && !selectionMode && (!isMobile || showActions) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, position: 'relative' }}>
          {isViewableFile(file) && (
            <button
              onClick={(e) => { e.stopPropagation(); onClearActions(); onOpenMediaViewer(file); }}
              title="View"
              disabled={isProcessing}
              style={actionBtn({ color: 'var(--accent)' })}
            >
              {is3dFile(file.name) ? <FiBox size={15} />
               : isVideo(file.name) ? <FiVideo size={15} />
               : isImage(file.name) ? <FiImage size={15} />
               : isAudio(file.name) ? <FiMusic size={15} />
               : isPdf(file.name) ? <FiFileText size={15} />
               : isXlsx(file.name) ? <FiFileText size={15} />
               : <FiFile size={15} />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClearActions(); onInitiateRename(file); }}
            title="Rename"
            disabled={isProcessing}
            style={actionBtn({ color: 'var(--text-2)' })}
          ><FiEdit size={15} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onClearActions(); onHandleDownload(file.id, file.name); }}
            title="Download"
            disabled={isProcessing}
            style={actionBtn({ color: 'var(--text-2)' })}
          ><FiDownload size={15} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onClearActions(); onInitiateDelete(file); }}
            title="Delete"
            disabled={isProcessing}
            style={actionBtn({ color: 'var(--danger)' })}
          ><FiTrash2 size={15} /></button>
          {onInitiateShare && (
            <button
              onClick={(e) => { e.stopPropagation(); onClearActions(); onInitiateShare(file); }}
              title="Share"
              disabled={isProcessing}
              style={actionBtn({ color: 'var(--success)' })}
            ><FiShare2 size={15} /></button>
          )}
        </div>
      )}

      {showActions && isMobile && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 0 }}
          onClick={(e) => { e.stopPropagation(); onClearActions(); }}
          onTouchEnd={(e) => { e.stopPropagation(); onClearActions(); }}
        />
      )}
    </div>
  );
});

const ListView = forwardRef(({
  files,
  creatingFolder,
  newFolderName,
  onNewFolderNameChange,
  onCancelCreateFolder,
  onConfirmCreateFolder,
  deletingFile,
  renamingFile,
  newFileName,
  setNewFileName,
  cancelDelete,
  confirmDelete,
  cancelRename,
  confirmRename,
  processingFile,
  handleContextMenu,
  navigateToFolder,
  formatFileSize,
  openMediaViewer,
  initiateRename,
  handleDownload,
  initiateDelete,
  initiateShare,
  sharedPaths,
  favoritePaths,
  currentPath,
  selectionMode,
  selectedFiles,
  onToggleSelect,
  onPauseDownload,
  onResumeDownload,
  onRemoveDownload,
  isGlobalSearch,
}, ref) => {
  const listRef = useRef(null);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimerRef = useRef(null);

  const checkMobile = useCallback(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
  }, []);

  useEffect(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [checkMobile]);

  // Refs that rowRenderer reads instead of closing over state. This keeps
  // rowRenderer's identity stable across selection / hover / share changes
  // so react-virtualized doesn't recreate the renderer; the forceUpdateGrid
  // effect below tells it when to repaint visible rows.
  const selectedFilesRef = useRef(selectedFiles);
  const processingFileRef = useRef(processingFile);
  const sharedPathsRef = useRef(sharedPaths);
  const favoritePathsRef = useRef(favoritePaths);
  const deletingFileIdRef = useRef(deletingFile?.id);
  const renamingFileIdRef = useRef(renamingFile?.id);
  const showingActionsForRef = useRef(showingActionsFor);

  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
  useEffect(() => { processingFileRef.current = processingFile; }, [processingFile]);
  useEffect(() => { sharedPathsRef.current = sharedPaths; }, [sharedPaths]);
  useEffect(() => { favoritePathsRef.current = favoritePaths; }, [favoritePaths]);
  useEffect(() => { deletingFileIdRef.current = deletingFile?.id; }, [deletingFile]);
  useEffect(() => { renamingFileIdRef.current = renamingFile?.id; }, [renamingFile]);
  useEffect(() => { showingActionsForRef.current = showingActionsFor; }, [showingActionsFor]);

  // Tell react-virtualized to repaint visible rows whenever the per-row state
  // that lives in refs changes. Memo on <ListRow> ensures only the rows whose
  // props actually changed re-render to the DOM.
  useEffect(() => {
    listRef.current?.forceUpdateGrid();
  }, [selectedFiles, processingFile, sharedPaths, favoritePaths, deletingFile, renamingFile, showingActionsFor]);

  const handleTouchStart = useCallback((file) => {
    if (!isMobile) return;
    longPressTimerRef.current = setTimeout(() => setShowingActionsFor(file.id), 500);
  }, [isMobile]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const clearActions = useCallback(() => setShowingActionsFor(null), []);

  const allItems = useMemo(() => {
    const items = [...files];
    if (creatingFolder) items.unshift({ id: 'new-folder', isCreating: true });
    return items;
  }, [files, creatingFolder]);

  const allItemsRef = useRef(allItems);
  useEffect(() => { allItemsRef.current = allItems; }, [allItems]);

  useImperativeHandle(ref, () => ({
    scrollToFile: (fileName) => {
      const index = allItemsRef.current.findIndex((f) => f.name === fileName);
      if (index >= 0 && listRef.current) listRef.current.scrollToRow(index);
    },
  }), []);

  const gridColsDesktop = isGlobalSearch ? '1fr 1fr 150px' : '1fr 150px 150px 200px';
  const gridColsMobile = '1fr 100px';
  const gridCols = isMobile ? gridColsMobile : gridColsDesktop;

  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const file = allItems[index];

      if (file.isCreating) {
        return (
          <div
            key={key}
            style={{
              ...style,
              padding: '8px 16px',
              background: 'color-mix(in oklab, var(--accent) 8%, var(--surface))',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <FiFolder color="var(--accent)" size={18} />
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirmCreateFolder();
                if (e.key === 'Escape') onCancelCreateFolder();
              }}
              autoFocus
              placeholder="Folder name…"
              style={{
                flex: 1,
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button onClick={onCancelCreateFolder} style={miniBtn('ghost')}>Cancel</button>
            <button onClick={onConfirmCreateFolder} style={miniBtn('primary')}>Create</button>
          </div>
        );
      }

      if (deletingFileIdRef.current === file.id) {
        return (
          <div
            key={key}
            style={{
              ...style,
              padding: '8px 16px',
              background: 'color-mix(in oklab, var(--danger) 14%, var(--surface))',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>
              Delete {file.isDirectory ? 'folder' : 'file'} "{file.name}"?
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={cancelDelete} style={miniBtn('ghost')}>Cancel</button>
              <button onClick={confirmDelete} style={miniBtn('danger')}>Delete</button>
            </div>
          </div>
        );
      }

      if (renamingFileIdRef.current === file.id) {
        return (
          <div
            key={key}
            style={{
              ...style,
              padding: '8px 16px',
              background: 'color-mix(in oklab, var(--accent) 8%, var(--surface))',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <ThumbBadge file={file} />
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') cancelRename();
              }}
              autoFocus
              style={{
                flex: 1,
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button onClick={cancelRename} style={miniBtn('ghost')}>Cancel</button>
            <button onClick={confirmRename} style={miniBtn('primary')}>Rename</button>
          </div>
        );
      }

      if (file.isDownloading) {
        return (
          <ListDownloadRow
            key={key}
            file={file}
            style={style}
            gridCols=""
            selectionMode={selectionMode}
            selectedFiles={selectedFilesRef.current}
            onToggleSelect={onToggleSelect}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
            onRemoveDownload={onRemoveDownload}
          />
        );
      }

      // Normal row — compute per-row props from refs, hand to memo'd ListRow.
      const isSelected = !!selectedFilesRef.current?.has(file.name);
      const pathKey = (currentPath ? `${currentPath}/${file.name}` : file.name)
        .replace(/\/+/g, '/')
        .replace(/^\//, '');
      const isShared = sharedPathsRef.current?.has(pathKey) ?? false;
      const isFavorite = favoritePathsRef.current?.has(pathKey) ?? false;
      const isProcessing = processingFileRef.current === file.id;
      const showActions = !deletingFileIdRef.current && !renamingFileIdRef.current && showingActionsForRef.current === file.id;

      const handleClick = (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        if (ctrl || shift) { e.preventDefault(); onToggleSelect?.(file, { ctrl, shift }); return; }
        if (selectionMode) { onToggleSelect?.(file); return; }
        if (showActions) return;
        if (file.isDirectory) navigateToFolder(file.name, file);
        else if (isViewableFile(file)) openMediaViewer(file);
      };

      return (
        <ListRow
          key={key}
          file={file}
          style={style}
          isMobile={isMobile}
          gridCols={gridCols}
          isGlobalSearch={isGlobalSearch}
          selectionMode={selectionMode}
          isSelected={isSelected}
          isShared={isShared}
          isFavorite={isFavorite}
          isProcessing={isProcessing}
          showActions={showActions}
          formatFileSize={formatFileSize}
          onClick={handleClick}
          onContextMenu={(e) => handleContextMenu(e, file)}
          onTouchStart={() => { if (!selectionMode) handleTouchStart(file); }}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onToggleSelect={onToggleSelect}
          onOpenMediaViewer={openMediaViewer}
          onInitiateRename={initiateRename}
          onHandleDownload={handleDownload}
          onInitiateDelete={initiateDelete}
          onInitiateShare={initiateShare}
          onClearActions={clearActions}
        />
      );
    },
    [
      allItems, isMobile, gridCols, isGlobalSearch, selectionMode, currentPath,
      newFolderName, newFileName,
      onCancelCreateFolder, onConfirmCreateFolder, onNewFolderNameChange,
      cancelDelete, confirmDelete, cancelRename, confirmRename, setNewFileName,
      handleContextMenu, navigateToFolder, openMediaViewer, initiateRename,
      handleDownload, initiateDelete, initiateShare, onToggleSelect,
      onPauseDownload, onResumeDownload, onRemoveDownload, formatFileSize,
      handleTouchStart, handleTouchEnd, handleTouchMove, clearActions,
    ],
  );

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            ref={listRef}
            height={height}
            width={width}
            rowCount={allItems.length}
            rowHeight={56}
            rowRenderer={rowRenderer}
            overscanRowCount={10}
            style={{ outline: 'none' }}
          />
        )}
      </AutoSizer>
    </div>
  );
});

function miniBtn(variant) {
  const base = {
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 'var(--r-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: 'none',
    transition: 'all 120ms',
  };
  if (variant === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (variant === 'danger')  return { ...base, background: 'var(--danger)', color: '#fff' };
  return { ...base, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' };
}

ListView.displayName = 'ListView';

export default memo(ListView);
