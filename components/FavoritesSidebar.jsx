/** @format */

'use client';

import { useState } from 'react';
import { FiFolder, FiFile, FiX, FiStar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useFavorites, useRemoveFavorite } from '@/lib/api/favorites';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function FavoritesSidebar({ onNavigate, currentPath }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { data: favorites = [], isLoading } = useFavorites();
  const removeFavorite = useRemoveFavorite();
  const { addNotification } = useNotifications();

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

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 w-10 bg-gray-800 border-r border-gray-700 flex flex-col">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          title="Expand favorites"
        >
          <FiChevronRight size={20} />
        </button>
        {favorites.length > 0 && (
          <div className="flex-1 flex flex-col items-center py-2 gap-1 overflow-y-auto">
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
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 w-56 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
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
    </div>
  );
}
