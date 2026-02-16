/** @format */

'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSearch } from '@/lib/api/search';
import { FiFolder, FiFile, FiX } from 'react-icons/fi';

export default function SearchOverlay({ query, onClose }) {
  const router = useRouter();
  const { data: results = [], isLoading } = useSearch(query);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleNavigate = useCallback(
    (parentPath) => {
      router.push(`/files?path=${encodeURIComponent(parentPath)}`);
      onClose?.();
    },
    [router, onClose],
  );

  // Separate results into folders and files
  const grouped = useMemo(() => {
    const folders = results.filter((r) => r.isDirectory);
    const files = results.filter((r) => !r.isDirectory);
    return { folders, files };
  }, [results]);

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Results card - positioned below search bar */}
      <div
        className="absolute top-16 left-4 right-4 sm:left-auto sm:right-auto sm:max-w-lg bg-gray-800 rounded-lg shadow-2xl border border-gray-700 max-h-96 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300">Search Results</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            aria-label="Close search"
          >
            <FiX size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Results */}
        <div className="divide-y divide-gray-700">
          {isLoading ? (
            // Loading skeleton
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-700 rounded animate-pulse" />
              ))}
            </div>
          ) : results.length === 0 ? (
            // Empty state
            <div className="p-8 text-center">
              <p className="text-gray-400 text-sm">
                {query.length < 2 ? 'Type at least 2 characters to search' : 'No results found'}
              </p>
            </div>
          ) : (
            <>
              {/* Folders section */}
              {grouped.folders.length > 0 && (
                <>
                  {grouped.folders.map((result) => (
                    <button
                      key={result.path}
                      onClick={() => handleNavigate(result.parentPath)}
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-700 transition-colors text-left"
                    >
                      <FiFolder className="text-blue-400 flex-shrink-0 mt-1" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">{result.name}</p>
                        <p className="text-gray-400 text-xs truncate">{result.parentPath || '/'}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Files section */}
              {grouped.files.length > 0 && (
                <>
                  {grouped.files.map((result) => (
                    <button
                      key={result.path}
                      onClick={() => handleNavigate(result.parentPath)}
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-700 transition-colors text-left"
                    >
                      <FiFile className="text-gray-400 flex-shrink-0 mt-1" size={18} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium truncate">{result.name}</p>
                          {result.extension && (
                            <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded whitespace-nowrap">
                              {result.extension}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 text-xs truncate">{result.parentPath || '/'}</p>
                      </div>
                      {result.size > 0 && (
                        <p className="text-gray-500 text-xs whitespace-nowrap">
                          {formatBytes(Number(result.size))}
                        </p>
                      )}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer with result count */}
        {results.length > 0 && (
          <div className="px-4 py-2 bg-gray-800/50 border-t border-gray-700 text-xs text-gray-400">
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </div>
        )}
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
