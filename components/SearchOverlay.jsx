/** @format */

'use client';

import { useMemo } from 'react';
import { useSearch } from '@/lib/api/search';
import { FiFolder, FiFile, FiSearch } from 'react-icons/fi';

export default function SearchResults({ query, currentPath, onNavigate }) {
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
      <div className="bg-gray-800 rounded-lg shadow mt-2 p-4 space-y-2">
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

  return (
    <div className="bg-gray-800 rounded-lg shadow mt-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700">
        <FiSearch size={14} className="text-gray-400" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Search Results ({filtered.length})
        </span>
      </div>

      {/* Folders section */}
      {grouped.folders.length > 0 && (
        <div>
          <div className="px-4 py-1.5 bg-gray-800/50 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Folders ({grouped.folders.length})
          </div>
          {grouped.folders.map((result) => (
            <button
              key={result.path}
              onClick={() => onNavigate(result.path)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left"
            >
              <FiFolder className="text-blue-400 flex-shrink-0" size={16} />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{result.name}</p>
                <p className="text-gray-500 text-xs truncate">{result.parentPath || '/'}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Files section */}
      {grouped.files.length > 0 && (
        <div>
          <div className="px-4 py-1.5 bg-gray-800/50 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Files ({grouped.files.length})
          </div>
          {grouped.files.map((result) => (
            <button
              key={result.path}
              onClick={() => onNavigate(result.parentPath)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left"
            >
              <FiFile className="text-gray-400 flex-shrink-0" size={16} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-medium truncate">{result.name}</p>
                  {result.extension && (
                    <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                      {result.extension}
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-xs truncate">{result.parentPath || '/'}</p>
              </div>
              {result.size > 0 && (
                <p className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0">
                  {formatBytes(Number(result.size))}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
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
