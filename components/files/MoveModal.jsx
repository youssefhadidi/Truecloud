/** @format */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiChevronRight, FiFolder, FiHome, FiX, FiArrowUp } from 'react-icons/fi';
import Overlay from '@/components/ui/Overlay';
import IconBtn from '@/components/ui/IconBtn';
import Btn from '@/components/ui/Btn';
import Spinner from '@/components/ui/Spinner';

export default function MoveModal({
  open,
  title = 'Move items',
  initialPath = '',
  fetchFolders,
  onConfirm,
  onClose,
}) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath);
  }, [open, initialPath]);

  useEffect(() => {
    if (!open) return;
    let isActive = true;
    const loadFolders = async () => {
      setLoading(true);
      setError('');
      try {
        const results = await fetchFolders(currentPath);
        if (!isActive) return;
        setFolders(results || []);
      } catch (err) {
        if (!isActive) return;
        setError(err?.message || 'Failed to load folders');
        setFolders([]);
      } finally {
        if (isActive) setLoading(false);
      }
    };
    loadFolders();
    return () => { isActive = false; };
  }, [open, currentPath, fetchFolders]);

  const breadcrumbParts = useMemo(() => (currentPath ? currentPath.split('/') : []), [currentPath]);

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  if (!open) return null;

  return (
    <Overlay onClose={onClose}>
      <div
        className="tc-anim-scale"
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-xl)',
          width: 540,
          maxWidth: '95vw',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
          <IconBtn icon={FiX} onClick={onClose} title="Close" />
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
            <button
              onClick={() => setCurrentPath('')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 'var(--r-xs)',
                border: 'none',
                background: 'transparent',
                color: !currentPath ? 'var(--text)' : 'var(--text-3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: !currentPath ? 600 : 500,
              }}
            >
              <FiHome size={13} />
              Root
            </button>
            {breadcrumbParts.map((part, index) => {
              const isLast = index === breadcrumbParts.length - 1;
              return (
                <span key={`${part}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <FiChevronRight size={12} color="var(--text-3)" />
                  <button
                    onClick={() => setCurrentPath(breadcrumbParts.slice(0, index + 1).join('/'))}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 'var(--r-xs)',
                      border: 'none',
                      background: 'transparent',
                      color: isLast ? 'var(--text)' : 'var(--text-3)',
                      fontWeight: isLast ? 600 : 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 13,
                    }}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Btn variant="surface" size="sm" onClick={goUp} disabled={!currentPath}>
              <FiArrowUp size={13} />
              Up one level
            </Btn>
            <Btn variant="primary" size="sm" onClick={() => onConfirm(currentPath)}>
              Move here
            </Btn>
          </div>

          {/* Folder list */}
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <Spinner size={22} color="var(--accent)" borderColor="var(--border)" thickness={3} />
            </div>
          ) : error ? (
            <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
          ) : folders.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>No folders here.</p>
          ) : (
            <div
              style={{
                maxHeight: 320,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)',
              }}
            >
              {folders.map((folder, i) => (
                <button
                  key={folder.name}
                  onClick={() =>
                    setCurrentPath(currentPath ? `${currentPath}/${folder.name}` : folder.name)
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    borderBottom: i < folders.length - 1 ? '1px solid var(--border)' : 'none',
                    textAlign: 'left',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <FiFolder size={15} color="var(--accent)" />
                  <span className="tc-truncate" style={{ flex: 1 }}>{folder.name}</span>
                  <FiChevronRight size={13} color="var(--text-3)" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}
