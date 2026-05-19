/** @format */

'use client';

import React, { useState, memo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FiFolder, FiFile, FiX, FiStar, FiChevronLeft, FiChevronRight,
  FiTrash2, FiSearch, FiHardDrive, FiDownload, FiShare2,
} from 'react-icons/fi';
import { useFavorites, useRemoveFavorite } from '@/lib/api/favorites';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { makeUsbPath } from '@/lib/usbPath';
import IconBtn from '@/components/ui/IconBtn';
import Divider from '@/components/ui/Divider';

function StorageBar() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/system-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setInfo(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const disk = info?.disk;
  if (!disk || !disk.total) return null;
  const used = disk.used ?? (disk.total - (disk.free || 0));
  const total = disk.total;
  const pct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
  const fmt = (b) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
  };

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Storage</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmt(used)} / {fmt(total)}</span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--accent), #8b5cf6)',
            borderRadius: 99,
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{pct}% used</div>
    </div>
  );
}

function NavRow({ icon: Icon, label, active, onClick, right, danger }) {
  const color = active ? 'var(--accent)' : danger ? 'var(--danger)' : 'var(--text-2)';
  const bg = active ? 'var(--accent-light)' : 'transparent';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 'var(--r-sm)',
        border: 'none',
        cursor: 'pointer',
        background: bg,
        color,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        transition: 'all 150ms',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={14} />
      <span className="tc-truncate" style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      {right}
    </button>
  );
}

function FavoritesSidebar({ onNavigate, currentPath, searchQuery, onSearchQueryChange }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { data: favorites = [], isLoading } = useFavorites();
  const removeFavorite = useRemoveFavorite();
  const { addNotification } = useNotifications();
  const router = useRouter();
  const { subscribe } = useWebSocket();
  const [usbDrives, setUsbDrives] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/usb-drives')
      .then((r) => (r.ok ? r.json() : { drives: [] }))
      .then((d) => { if (!cancelled) setUsbDrives(d.drives || []); })
      .catch(() => {});
    const unsub = subscribe('usb-drives', (msg) => {
      setUsbDrives(Array.isArray(msg.payload) ? msg.payload : []);
    });
    return () => { cancelled = true; unsub(); };
  }, [subscribe]);

  const mountedPartitions = usbDrives.flatMap((d) =>
    d.partitions
      .filter((p) => p.mountpoint)
      .map((p) => ({
        key: `${d.name}-${p.name}`,
        mountpoint: p.mountpoint,
        label: p.label || p.uuid || p.name,
        drive: d.model || d.vendor || d.name,
      })),
  );

  const isInTrash = currentPath === 'trash' || currentPath?.startsWith('trash/') || currentPath?.startsWith('trash\\');

  const handleRemove = async (e, favorite) => {
    e.stopPropagation();
    try {
      await removeFavorite.mutateAsync({ id: favorite.id });
      addNotification('success', 'Removed from favorites');
    } catch {
      addNotification('error', 'Failed to remove favorite');
    }
  };

  const handleNavigate = (favorite) => {
    if (favorite.isDirectory) onNavigate(favorite.path);
    else onNavigate(favorite.path.split('/').slice(0, -1).join('/'));
  };

  if (isCollapsed) {
    return (
      <aside
        style={{
          width: 44,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <IconBtn
          icon={FiChevronRight}
          title="Expand favorites"
          onClick={() => setIsCollapsed(false)}
          style={{ margin: 6 }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0', overflowY: 'auto' }}>
          {mountedPartitions.map((part) => (
            <IconBtn
              key={part.key}
              icon={FiHardDrive}
              title={`${part.drive} — ${part.mountpoint}`}
              onClick={() => onNavigate(makeUsbPath(part.mountpoint))}
            />
          ))}
          {favorites.slice(0, 10).map((fav) => (
            <IconBtn
              key={fav.id}
              icon={fav.isDirectory ? FiFolder : FiFile}
              title={fav.name}
              active={currentPath === fav.path}
              onClick={() => handleNavigate(fav)}
            />
          ))}
        </div>
        <IconBtn
          icon={FiTrash2}
          title="Trash"
          danger={isInTrash}
          active={isInTrash}
          onClick={() => onNavigate('trash')}
          style={{ margin: 6 }}
        />
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Search */}
      <div style={{ padding: '14px 12px 10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '8px 12px',
            transition: 'border 150ms',
          }}
        >
          <FiSearch size={14} color="var(--text-3)" style={{ flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            placeholder="Search files…"
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              color: 'var(--text)',
              outline: 'none',
              flex: 1,
              fontFamily: 'inherit',
              minWidth: 0,
            }}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange?.('')}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--text-3)',
                display: 'flex',
                padding: 0,
              }}
            >
              <FiX size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div style={{ padding: '4px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.08em', padding: '0 4px' }}>
          FAVORITES
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          title="Collapse"
          style={{
            width: 22,
            height: 22,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-3)',
            borderRadius: 'var(--r-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FiChevronLeft size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div
              style={{
                width: 18,
                height: 18,
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: 99,
                animation: 'tc-spin 700ms linear infinite',
              }}
            />
          </div>
        ) : favorites.length === 0 ? (
          <div style={{ padding: '14px 8px', textAlign: 'center', color: 'var(--text-3)' }}>
            <FiStar size={20} style={{ opacity: 0.5, marginBottom: 6 }} />
            <div style={{ fontSize: 12, fontWeight: 600 }}>No favorites yet</div>
            <div style={{ fontSize: 11, marginTop: 2 }}>Right-click files to add</div>
          </div>
        ) : (
          favorites.map((fav) => {
            const active = currentPath === fav.path;
            return (
              <NavRow
                key={fav.id}
                icon={fav.isDirectory ? FiFolder : FiFile}
                label={fav.name}
                active={active}
                onClick={() => handleNavigate(fav)}
                right={
                  <button
                    onClick={(e) => handleRemove(e, fav)}
                    title="Remove favorite"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: active ? 'var(--accent)' : 'var(--text-3)',
                      padding: 2,
                      display: 'flex',
                      borderRadius: 'var(--r-xs)',
                    }}
                  >
                    <FiX size={12} />
                  </button>
                }
              />
            );
          })
        )}

        {mountedPartitions.length > 0 && (
          <>
            <Divider />
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-3)',
                letterSpacing: '.08em',
                padding: '6px 4px 4px',
              }}
            >
              USB DRIVES
            </div>
            {mountedPartitions.map((part) => (
              <NavRow
                key={part.key}
                icon={FiHardDrive}
                label={part.label}
                active={currentPath === makeUsbPath(part.mountpoint) || currentPath?.startsWith(`${makeUsbPath(part.mountpoint)}/`)}
                onClick={() => onNavigate(makeUsbPath(part.mountpoint))}
              />
            ))}
          </>
        )}

        <Divider />
        <NavRow
          icon={FiDownload}
          label="Downloads"
          active={currentPath === '__downloads__'}
          onClick={() => router.push('/downloads')}
        />
        <NavRow
          icon={FiShare2}
          label="Shares"
          active={currentPath === '__shares__'}
          onClick={() => router.push('/shares')}
        />
        <NavRow
          icon={FiTrash2}
          label="Trash"
          active={isInTrash}
          onClick={() => onNavigate('trash')}
        />
      </div>

      <StorageBar />
    </aside>
  );
}

export default memo(FavoritesSidebar);
