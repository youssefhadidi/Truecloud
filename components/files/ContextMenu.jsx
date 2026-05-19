/** @format */

'use client';

import { useEffect, useRef } from 'react';
import {
  FiFolder, FiEdit, FiDownload, FiVideo, FiImage, FiTrash2, FiBox, FiShare2,
  FiRotateCcw, FiStar, FiMusic, FiFileText,
} from 'react-icons/fi';
import { isImage, isVideo, isAudio, isPdf, isXlsx, is3dFile } from '@/lib/clientFileUtils';

const isInTrash = (path) => path === 'trash' || path.startsWith('trash/') || path.startsWith('trash\\');

function MenuItem({ icon: Icon, label, onClick, danger, accent }) {
  const color = danger ? 'var(--danger)' : accent ? 'var(--accent)' : 'var(--text)';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        fontSize: 13,
        fontWeight: 500,
        borderRadius: 'var(--r-xs)',
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
        color,
        transition: 'background 120ms',
        fontFamily: 'inherit',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {Icon && <Icon size={14} color={danger ? 'var(--danger)' : 'var(--text-2)'} />}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
}

export default function ContextMenu({
  contextMenu,
  file,
  currentPath = '',
  onNavigateToFolder,
  onRename,
  onDownload,
  onView,
  onDelete,
  onRestore,
  onShare,
  onToggleFavorite,
  isFavorite = false,
  onClose,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    }
    function escHandler(e) {
      if (e.key === 'Escape') onClose?.();
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', escHandler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [contextMenu, onClose]);

  if (!contextMenu || !file) return null;

  const inTrash = isInTrash(currentPath);
  const adjX = Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220);
  const adjY = Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320);

  let viewIcon = null;
  if (file && !file.isDirectory) {
    if (is3dFile(file.name)) viewIcon = FiBox;
    else if (isVideo(file.name)) viewIcon = FiVideo;
    else if (isImage(file.name)) viewIcon = FiImage;
    else if (isAudio(file.name)) viewIcon = FiMusic;
    else if (isPdf(file.name) || isXlsx(file.name)) viewIcon = FiFileText;
  }

  return (
    <div
      ref={ref}
      className="tc-anim-scale"
      style={{
        position: 'fixed',
        left: adjX,
        top: adjY,
        zIndex: 9000,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-xl)',
        padding: 4,
        minWidth: 200,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {file.isDirectory ? (
        <>
          <MenuItem icon={FiFolder} label="Open Folder" onClick={onNavigateToFolder} />
          {!inTrash && (
            <>
              {onRename && <MenuItem icon={FiEdit} label="Rename" onClick={onRename} />}
              {onDownload && <MenuItem icon={FiDownload} label="Download as ZIP" onClick={onDownload} />}
            </>
          )}
        </>
      ) : (
        <>
          {onDownload && <MenuItem icon={FiDownload} label="Download" onClick={onDownload} />}
          {!inTrash && onRename && <MenuItem icon={FiEdit} label="Rename" onClick={onRename} />}
          {viewIcon && onView && <MenuItem icon={viewIcon} label="View" onClick={onView} accent />}
        </>
      )}

      {!inTrash && (
        <>
          {onToggleFavorite && (
            <MenuItem
              icon={FiStar}
              label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
              onClick={onToggleFavorite}
            />
          )}
          {onShare && <MenuItem icon={FiShare2} label="Share" onClick={onShare} />}
        </>
      )}

      {(inTrash || onDelete) && (
        <>
          <MenuDivider />
          {inTrash ? (
            <>
              <MenuItem icon={FiRotateCcw} label="Restore" onClick={onRestore} accent />
              <MenuItem icon={FiTrash2} label="Delete Permanently" onClick={onDelete} danger />
            </>
          ) : (
            <MenuItem icon={FiTrash2} label="Delete" onClick={onDelete} danger />
          )}
        </>
      )}
    </div>
  );
}
