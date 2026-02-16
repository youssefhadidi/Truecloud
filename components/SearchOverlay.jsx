/** @format */

'use client';

import { useMemo } from 'react';
import { useSearch } from '@/lib/api/search';
import { FiFolder, FiFile, FiSearch, FiImage, FiVideo } from 'react-icons/fi';
import { isImage, isVideo } from '@/lib/clientFileUtils';

function getFileIcon(name, isDirectory) {
  if (isDirectory) return <FiFolder className="text-blue-400" size={32} />;
  if (isImage(name)) return <FiImage className="text-green-400" size={32} />;
  if (isVideo(name)) return <FiVideo className="text-purple-400" size={32} />;
  return <FiFile className="text-gray-400" size={32} />;
}

function getFileIconSmall(name, isDirectory) {
  if (isDirectory) return <FiFolder className="text-blue-400" size={18} />;
  if (isImage(name)) return <FiImage className="text-green-400" size={18} />;
  if (isVideo(name)) return <FiVideo className="text-purple-400" size={18} />;
  return <FiFile className="text-gray-400" size={18} />;
}

export default function SearchResults({ query, currentPath, onNavigate, viewMode = 'grid' }) {
  const { data: results = [], isLoading } = useSearch(query);

  // Filter out results that are in the current path (already visible in the list/grid above)
  const filtered = useMemo(() => {
    return results.filter((r) => {
      const parentPath = r.parentPath || '';
      return parentPath !== currentPath;
    });
  }, [results, currentPath]);

  // Separate results into folders and files
  const grouped = useMemo(() => {
    const folders = filtered.filter((r) => r.isDirectory);
    const files = filtered.filter((r) => !r.isDirectory);
    return { folders, files };
  }, [filtered]);

  if (!query || query.length < 2) return null;

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg shadow p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <FiSearch size={14} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Search Results
          </span>
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-700 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) return null;

  const renderSection = (items, label) => {
    if (items.length === 0) return null;

    if (viewMode === 'grid') {
      return (
        <div>
          <div className="px-4 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
            {label} ({items.length})
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-1 p-1">
            {items.map((result) => (
              <button
                key={result.path}
                onClick={() =>
                  onNavigate(result.isDirectory ? result.path : result.parentPath, result.isDirectory ? null : result.name)
                }
                className="group relative bg-gray-700 rounded-lg p-0 hover:bg-gray-600 transition-colors cursor-pointer flex flex-col select-none overflow-hidden"
              >
                <div className="w-full aspect-square flex items-center justify-center bg-gray-600">
                  {getFileIcon(result.name, result.isDirectory)}
                </div>
                <div className="px-1 py-1.5">
                  <p className="text-white text-xs font-medium truncate">{result.name}</p>
                  <p className="text-gray-500 text-[10px] truncate">{result.parentPath || '/'}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // List view
    return (
      <div>
        <div className="px-4 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
          {label} ({items.length})
        </div>
        {items.map((result) => (
          <button
            key={result.path}
            onClick={() =>
              onNavigate(result.isDirectory ? result.path : result.parentPath, result.isDirectory ? null : result.name)
            }
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left"
          >
            {getFileIconSmall(result.name, result.isDirectory)}
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{result.name}</p>
              <p className="text-gray-500 text-xs truncate">{result.parentPath || '/'}</p>
            </div>
            {!result.isDirectory && result.extension && (
              <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                {result.extension}
              </span>
            )}
            {!result.isDirectory && result.size > 0 && (
              <p className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0">
                {formatBytes(Number(result.size))}
              </p>
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow flex-1 min-h-0 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-800">
        <FiSearch size={14} className="text-gray-400" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Search Results ({filtered.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {renderSection(grouped.folders, 'Folders')}
        {renderSection(grouped.files, 'Files')}
      </div>
    </div>
  );
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
