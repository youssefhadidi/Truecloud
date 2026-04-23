/** @format */

'use client';

import React, { useState, memo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FiFolder, FiFile, FiX, FiStar, FiChevronLeft, FiChevronRight, FiTrash2, FiSearch, FiHardDrive } from 'react-icons/fi';
import { useFavorites, useRemoveFavorite } from '@/lib/api/favorites';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';

function FavoritesSidebar({ onNavigate, currentPath, searchQuery, onSearchQueryChange }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { data: favorites = [], isLoading } = useFavorites();
  const removeFavorite = useRemoveFavorite();
  const { addNotification } = useNotifications();
  const router = useRouter();
  const { subscribe } = useWebSocket();
  const [usbDrives, setUsbDrives] = useState([]);

  // Seed from REST, then receive live updates via WebSocket
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

  // Flatten to only partitions that are actually mounted (browsable)
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

  const openDrive = (mp) => {
    router.push(`/usb?mount=${encodeURIComponent(mp)}`);
  };

  const handleRemove = async (e, favorite) => {
    e.stopPropagation();
    try {
      await removeFavorite.mutateAsync({ id: favorite.id });
      addNotification('success', 'Removed from favorites');
    } catch (error) {
      addNotification('error', 'Failed to remove favorite');
    }
  };

  const handleNavigate = (favorite) => {
    if (favorite.isDirectory) {
      onNavigate(favorite.path);
    } else {
      // Navigate to parent folder of file
      const parentPath = favorite.path.split('/').slice(0, -1).join('/');
      onNavigate(parentPath);
    }
  };

  const isInTrash = currentPath === 'trash' || currentPath.startsWith('trash/') || currentPath.startsWith('trash\\');

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 w-10 h-full bg-gray-800 border-r border-gray-700 flex flex-col">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          title="Expand favorites"
        >
          <FiChevronRight size={20} />
        </button>
        {(favorites.length > 0 || mountedPartitions.length > 0) && (
          <div className="flex-1 flex flex-col items-center py-2 gap-1 overflow-y-auto">
            {mountedPartitions.map((part) => (
              <button
                key={part.key}
                onClick={() => openDrive(part.mountpoint)}
                className="p-2 rounded hover:bg-gray-700 transition-colors text-indigo-300"
                title={`${part.drive} — ${part.mountpoint}`}
              >
                <FiHardDrive size={16} />
              </button>
            ))}
            {favorites.slice(0, 10).map((favorite) => (
              <button
                key={favorite.id}
                onClick={() => handleNavigate(favorite)}
                className={`p-2 rounded hover:bg-gray-700 transition-colors ${
                  currentPath === favorite.path ? 'bg-indigo-600 text-white' : 'text-gray-400'
                }`}
                title={favorite.name}
              >
                {favorite.isDirectory ? <FiFolder size={16} /> : <FiFile size={16} />}
              </button>
            ))}
          </div>
        )}
        {/* Trash button at bottom */}
        <button
          onClick={() => onNavigate('trash')}
          className={`p-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors mt-auto ${
            isInTrash ? 'bg-red-600/20 text-red-400' : ''
          }`}
          title="Trash"
        >
          <FiTrash2 size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 w-56 h-full bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
      <div className="px-2 py-2 border-b border-gray-700">
        <div className="relative flex items-center">
          <FiSearch size={14} className="absolute left-2 text-gray-500" />
          <input
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            placeholder="Search all files..."
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-gray-700 text-white placeholder-gray-500 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange?.('')}
              className="absolute right-1.5 p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <FiX size={12} />
            </button>
          )}
        </div>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2 text-gray-300">
          <FiStar size={16} className="text-yellow-500" />
          <span className="text-sm font-medium">Favorites</span>
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          title="Collapse"
        >
          <FiChevronLeft size={16} />
        </button>
      </div>

      {/* Search Input */}

      {/* USB Drives (only shown when drives are mounted) */}
      {mountedPartitions.length > 0 && (
        <div className="border-b border-gray-700">
          <div className="flex items-center gap-2 px-3 py-2 text-gray-300">
            <FiHardDrive size={16} className="text-indigo-400" />
            <span className="text-sm font-medium">USB Drives</span>
          </div>
          <div className="pb-1">
            {mountedPartitions.map((part) => (
              <div
                key={part.key}
                onClick={() => openDrive(part.mountpoint)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer text-gray-300 hover:bg-gray-700 transition-colors"
                title={part.mountpoint}
              >
                <FiHardDrive size={14} className="flex-shrink-0 text-indigo-400" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">{part.label}</div>
                  <div className="truncate text-xs text-gray-500">{part.drive}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Favorites list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
            </div>
          ) : favorites.length === 0 ? (
            <div className="px-3 py-4 text-center text-gray-500 text-sm">
              <FiStar size={24} className="mx-auto mb-2 opacity-50" />
              <p>No favorites yet</p>
              <p className="text-xs mt-1">Right-click files to add</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {favorites.map((favorite) => (
                <div
                  key={favorite.id}
                  onClick={() => handleNavigate(favorite)}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    currentPath === favorite.path
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {favorite.isDirectory ? (
                    <FiFolder size={16} className="flex-shrink-0 text-indigo-400" />
                  ) : (
                    <FiFile size={16} className="flex-shrink-0 text-gray-400" />
                  )}
                  <span className="flex-1 truncate text-sm">{favorite.name}</span>
                  <button
                    onClick={(e) => handleRemove(e, favorite)}
                    className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                      currentPath === favorite.path
                        ? 'hover:bg-indigo-500 text-white'
                        : 'hover:bg-gray-600 text-gray-400'
                    }`}
                    title="Remove from favorites"
                  >
                    <FiX size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Trash link at bottom */}
      <div className="border-t border-gray-700">
        <button
          onClick={() => onNavigate('trash')}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
            isInTrash
              ? 'bg-red-600/20 text-red-400'
              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'
          }`}
        >
          <FiTrash2 size={16} />
          <span>Trash</span>
        </button>
      </div>
    </div>
  );
}

export default memo(FavoritesSidebar);
