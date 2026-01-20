/** @format */

'use client';

import { useRef, useMemo, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf } from '@/lib/clientFileUtils';

// Breakpoints and constants
const BREAKPOINT = {
  xs: 375,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const ITEM_ASPECT_RATIO = 1; // Square items

// Throttle helper
const throttle = (func, delay) => {
  let timeoutId;
  let lastRan;
  return (...args) => {
    if (!lastRan) {
      func(...args);
      lastRan = Date.now();
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (Date.now() - lastRan >= delay) {
          func(...args);
          lastRan = Date.now();
        }
      }, delay - (Date.now() - lastRan));
    }
  };
};

// Calculate gap based on breakpoints
const getItemGap = (width) => {
  if (width < BREAKPOINT.sm) return 8; // gap-2
  return 8; // gap-2
};

// Calculate column count based on breakpoints
const getColumnsCount = (width) => {
  if (width < BREAKPOINT.sm) return 2; // sm
  if (width < BREAKPOINT.md) return 4; // md
  if (width < BREAKPOINT.lg) return 5; // lg
  if (width < BREAKPOINT.xl) return 8; // xl
  return 9; // 2xl
};

// Calculate item width
const getItemWidth = (width, columns, gapX) => {
  const padding = 16; // px-2 on both sides
  const totalGap = (columns - 1) * gapX;
  return (width - padding - totalGap) / columns;
};

// Calculate item height (square aspect ratio)
const getItemHeight = (itemWidth) => {
  return itemWidth;
};

const GridView = ({
  files,
  creatingFolder,
  newFolderName,
  onNewFolderNameChange,
  onCancelCreateFolder,
  onConfirmCreateFolder,
  deletingFile,
  renamingFile,
  newFileName,
  onNewFileNameChange,
  onCancelRename,
  onConfirmRename,
  processingFile,
  currentPath,
  onNavigateToFolder,
  onOpenMediaViewer,
  onInitiateRename,
  onHandleDownload,
  onInitiateDelete,
  onConfirmDelete,
  onCancelDelete,
  formatFileSize,
}) => {
  const parentRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [gap, setGap] = useState(8);
  const [columns, setColumns] = useState(8);
  const [itemSize, setItemSize] = useState({ width: 150, height: 150 });

  const allItems = useMemo(() => {
    const items = [...files];
    if (creatingFolder) {
      items.unshift({ id: 'new-folder', isCreating: true });
    }
    return items;
  }, [files, creatingFolder]);

  // ResizeObserver to track container width changes
  useEffect(() => {
    const handleResize = throttle(() => {
      if (parentRef.current) {
        const width = parentRef.current.clientWidth;
        setContainerWidth(width);

        const newGap = getItemGap(width);
        const newColumns = getColumnsCount(width);
        const newItemWidth = getItemWidth(width, newColumns, newGap);
        const newItemHeight = getItemHeight(newItemWidth);

        setGap(newGap);
        setColumns(newColumns);
        setItemSize({
          width: Math.floor(newItemWidth),
          height: Math.floor(newItemHeight),
        });
      }
    }, 200);

    const resizeObserver = new ResizeObserver(handleResize);

    if (parentRef.current) {
      resizeObserver.observe(parentRef.current);
      handleResize(); // Initial call
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Use column virtualizer for horizontal scrolling (columns)
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize.width + gap,
    overscan: 3,
  });

  // Calculate actual row count based on dynamic column count
  const rowCount = Math.ceil(allItems.length / columns);

  // Use row virtualizer for vertical scrolling (rows)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize.height + gap,
    overscan: 5,
  });

  // Re-measure virtualizers when size changes
  useEffect(() => {
    rowVirtualizer.measure();
    columnVirtualizer.measure();
  }, [itemSize.height, columns, rowVirtualizer, columnVirtualizer]);

  return (
    <div ref={parentRef} className="w-full h-full overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: `${columnVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div key={virtualRow.key}>
            {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
              const itemIndex = virtualRow.index * columns + virtualColumn.index;
              const item = allItems[itemIndex];

              if (!item) return null;

              return (
                <div
                  key={`${virtualRow.key}-${virtualColumn.key}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${virtualColumn.size}px`,
                    height: `${virtualRow.size}px`,
                    transform: `translateX(${virtualColumn.start}px) translateY(${virtualRow.start}px)`,
                  }}
                >
                  {item.isCreating ? (
                    <div className="group relative bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 border-2 border-blue-300 dark:border-blue-700 flex flex-col m-1 h-[calc(100%-8px)]">
                      <div className="aspect-square flex items-center justify-center mb-2 bg-white dark:bg-gray-600 rounded-lg flex-shrink-0">
                        <FiFolder className="text-blue-500" size={48} />
                      </div>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => onNewFolderNameChange(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') onConfirmCreateFolder();
                          if (e.key === 'Escape') onCancelCreateFolder();
                        }}
                        className="w-full px-2 py-1 text-sm mb-2 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        autoFocus
                        onFocus={(e) => e.target.select()}
                      />
                      <div className="flex gap-1 mt-auto">
                        <button
                          onClick={onCancelCreateFolder}
                          className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                        <button onClick={onConfirmCreateFolder} className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                          Create
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="group relative bg-gray-50 dark:bg-gray-700 rounded-lg p-2 hover:shadow-lg transition-shadow cursor-pointer flex flex-col aspect-square m-1 h-[calc(100%-8px)]"
                      onClick={() => item.isDirectory && deletingFile?.id !== item.id && onNavigateToFolder(item.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                      }}
                    >
                      {deletingFile?.id === item.id ? (
                        <div className="absolute inset-0 bg-red-50 dark:bg-red-900/90 rounded-lg p-4 flex flex-col items-center justify-center gap-3 z-10">
                          <p className="text-red-800 dark:text-red-200 font-medium text-center text-sm">Delete {item.isDirectory ? 'folder' : 'file'}?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCancelDelete();
                              }}
                              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onConfirmDelete();
                              }}
                              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : renamingFile?.id === item.id ? (
                        <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/90 rounded-lg p-4 flex flex-col items-center justify-center gap-3 z-10">
                          <input
                            type="text"
                            value={newFileName}
                            onChange={(e) => onNewFileNameChange(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') onConfirmRename();
                              if (e.key === 'Escape') onCancelRename();
                            }}
                            className="w-full px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCancelRename();
                              }}
                              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onConfirmRename();
                              }}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Rename
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div
                        className={`w-full flex-1 flex items-center justify-center mb-2 bg-white dark:bg-gray-600 rounded-lg relative overflow-hidden ${
                          isImage(item.name) || isVideo(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name)
                            ? 'cursor-pointer hover:opacity-90 transition-opacity'
                            : ''
                        }`}
                        onClick={(e) => {
                          if (isImage(item.name) || isVideo(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name)) {
                            e.stopPropagation();
                            onOpenMediaViewer(item);
                          }
                        }}
                      >
                        {processingFile === item.id && (
                          <div className="absolute inset-0 bg-white dark:bg-gray-600 bg-opacity-75 dark:bg-opacity-75 rounded-lg flex items-center justify-center z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                          </div>
                        )}
                        {isImage(item.name) && (
                          <LazyImage
                            src={`/api/files/thumbnail/${item.id}?path=${encodeURIComponent(currentPath)}`}
                            alt={item.name}
                            className="w-full h-full object-cover rounded-lg"
                            isThumbnail={true}
                            onError={(e) => {
                              e.target.style.display = 'none';
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        )}
                        {isVideo(item.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${item.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={item.name}
                              className="w-full h-full object-cover rounded-lg"
                              isThumbnail={true}
                              onError={(e) => {
                                e.target.style.display = 'none';
                                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black bg-opacity-60 rounded-full p-3">
                                <FiVideo className="text-white" size={24} />
                              </div>
                            </div>
                            <div className="hidden flex items-center justify-center w-full h-full" />
                          </div>
                        )}
                        {isPdf(item.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${item.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={item.name}
                              className="w-full h-full object-cover rounded-lg"
                              isThumbnail={true}
                              onError={(e) => {
                                if (e?.target) {
                                  e.target.style.display = 'none';
                                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                                }
                              }}
                            />
                            <div className="hidden flex items-center justify-center w-full h-full" />
                          </div>
                        )}
                        {item.isDirectory && <FiFolder className="text-blue-500" size={48} />}
                        {!item.isDirectory && is3dFile(item.name) && <FiBox className="text-orange-500" size={48} />}
                        {!item.isDirectory && !isImage(item.name) && !isVideo(item.name) && !isPdf(item.name) && !is3dFile(item.name) && (
                          <FiFile className="text-gray-500" size={48} />
                        )}
                      </div>

                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate px-1 min-h-[20px]" title={item.displayName || item.name}>
                        {item.displayName || item.name}
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400 px-1 mt-auto">{item.isDirectory ? '' : formatFileSize(item.size)}</div>

                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1">
                        {(isVideo(item.name) || isImage(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name)) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMediaViewer(item);
                            }}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="View"
                            disabled={processingFile === item.id}
                          >
                            {is3dFile(item.name) ? (
                              <FiBox size={16} className="text-orange-600 dark:text-orange-400" />
                            ) : isVideo(item.name) ? (
                              <FiVideo size={16} className="text-purple-600 dark:text-purple-400" />
                            ) : isImage(item.name) ? (
                              <FiImage size={16} className="text-green-600 dark:text-green-400" />
                            ) : isAudio(item.name) ? (
                              <FiVideo size={16} className="text-blue-600 dark:text-blue-400" />
                            ) : isPdf(item.name) ? (
                              <FiFile size={16} className="text-red-600 dark:text-red-400" />
                            ) : null}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onInitiateRename(item);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Rename"
                          disabled={processingFile === item.id}
                        >
                          <FiEdit size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onHandleDownload(item.id, item.name);
                          }}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Download"
                          disabled={processingFile === item.id}
                        >
                          <FiDownload size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onInitiateDelete(item);
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                          disabled={processingFile === item.id}
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GridView;
