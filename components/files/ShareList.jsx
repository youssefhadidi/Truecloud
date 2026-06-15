/** @format */

'use client';

import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { List, AutoSizer } from 'react-virtualized';
import {
  FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2,
  FiMusic, FiFileText, FiPackage, FiCheck,
} from 'react-icons/fi';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx, is3dFile } from '@/lib/clientFileUtils';
import { fileKind, ftClass } from '@/components/files/fileKindUtils';
import { useTranslation } from '@/components/LanguageProvider';

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

function ShareList({
  files = [],
  allowEditing = false,
  deletingFile,
  renamingFile,
  newFileName,
  setNewFileName,
  cancelDelete,
  confirmDelete,
  cancelRename,
  confirmRename,
  processingFile,
  onFileClick,
  onDownload,
  onContextMenu,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
  selectionMode,
  selectedFiles,
  onToggleSelect,
}) {
  const { t } = useTranslation();
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

  const handleTouchStart = useCallback((file) => {
    if (!isMobile) return;
    longPressTimerRef.current = setTimeout(() => setShowingActionsFor(file.name), 500);
  }, [isMobile]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const shouldShowActions = useCallback(
    (fileName) => {
      if (deletingFile?.name || renamingFile?.name) return false;
      return showingActionsFor === fileName;
    },
    [deletingFile, renamingFile, showingActionsFor],
  );

  const gridColsDesktop = '1fr 150px 150px 200px';
  const gridColsMobile = '1fr 100px';

  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const file = files[index];

      if (deletingFile?.name === file.name) {
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
              {file.isDirectory
                ? t('fileItem.deleteFolderNamedQ', { name: file.name })
                : t('fileItem.deleteFileNamedQ', { name: file.name })}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={cancelDelete} style={miniBtn('ghost')}>{t('common.cancel')}</button>
              <button onClick={confirmDelete} style={miniBtn('danger')}>{t('common.delete')}</button>
            </div>
          </div>
        );
      }

      if (renamingFile?.name === file.name) {
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
            <button onClick={cancelRename} style={miniBtn('ghost')}>{t('common.cancel')}</button>
            <button onClick={confirmRename} style={miniBtn('primary')}>{t('common.rename')}</button>
          </div>
        );
      }

      const isSelected = !!selectedFiles?.has(file.name);

      return (
        <div
          key={key}
          className="tc-list-row"
          style={{
            ...style,
            display: 'grid',
            gridTemplateColumns: isMobile ? gridColsMobile : gridColsDesktop,
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
          onClick={(e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            const shift = e.shiftKey;
            if (ctrl || shift) { e.preventDefault(); onToggleSelect?.(file, { ctrl, shift }); return; }
            if (selectionMode) { onToggleSelect?.(file); return; }
            if (shouldShowActions(file.name)) return;
            onFileClick(file);
          }}
          onContextMenu={(e) => onContextMenu(e, file)}
          onTouchStart={() => { if (!selectionMode) handleTouchStart(file); }}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
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
            {processingFile === file.name ? (
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
              <ThumbBadge file={file} />
            )}
            <span
              className="tc-truncate"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: file.isDirectory ? 'var(--accent)' : 'var(--text)',
              }}
              title={file.name}
            >
              {file.name}
            </span>
          </div>

          {!isMobile && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
              {file.isDirectory ? '—' : formatFileSize(file.size)}
            </div>
          )}
          {!isMobile && (
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : ''}
            </div>
          )}

          {!selectionMode && (!isMobile || shouldShowActions(file.name)) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, position: 'relative' }}>
              {isViewableFile(file) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onOpenMediaViewer(file); }}
                  title={t('menu.view')}
                  disabled={processingFile === file.name}
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
              {allowEditing && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onInitiateRename(file); }}
                  title={t('common.rename')}
                  disabled={processingFile === file.name}
                  style={actionBtn({ color: 'var(--text-2)' })}
                ><FiEdit size={15} /></button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onDownload(file); }}
                title={t('common.download')}
                disabled={processingFile === file.name}
                style={actionBtn({ color: 'var(--text-2)' })}
              ><FiDownload size={15} /></button>
              {allowEditing && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); onInitiateDelete(file); }}
                  title={t('common.delete')}
                  disabled={processingFile === file.name}
                  style={actionBtn({ color: 'var(--danger)' })}
                ><FiTrash2 size={15} /></button>
              )}
            </div>
          )}

          {shouldShowActions(file.name) && isMobile && (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 0 }}
              onClick={(e) => { e.stopPropagation(); setShowingActionsFor(null); }}
              onTouchEnd={(e) => { e.stopPropagation(); setShowingActionsFor(null); }}
            />
          )}
        </div>
      );
    },
    [
      files, deletingFile, renamingFile, newFileName, isMobile, allowEditing,
      selectionMode, selectedFiles, processingFile, shouldShowActions,
      onFileClick, onOpenMediaViewer, onInitiateRename, setNewFileName, cancelRename, confirmRename,
      onDownload, onInitiateDelete, cancelDelete, confirmDelete, onToggleSelect,
      formatFileSize, onContextMenu, handleTouchStart, handleTouchEnd, handleTouchMove,
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
            rowCount={files.length}
            rowHeight={56}
            rowRenderer={rowRenderer}
            overscanRowCount={10}
            style={{ outline: 'none' }}
          />
        )}
      </AutoSizer>
    </div>
  );
}

export default memo(ShareList);
