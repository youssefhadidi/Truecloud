/** @format */

'use client';

import { useRef, useMemo, useCallback } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';
import 'react-virtualized/styles.css';

// Breakpoints
const BREAKPOINT = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const getColumnsCount = (width) => {
  if (width < BREAKPOINT.sm) return 2;
  if (width < BREAKPOINT.md) return 3;
  if (width < BREAKPOINT.lg) return 4;
  if (width < BREAKPOINT.xl) return 5;
  if (width < BREAKPOINT['2xl']) return 8;
  return 9;
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
  const gridRef = useRef(null);

  const allItems = useMemo(() => {
    const items = [...files];
    if (creatingFolder) {
      items.unshift({ id: 'new-folder', isCreating: true });
    }
    return items;
  }, [files, creatingFolder]);

  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style, parent }) => {
      const containerWidth = parent.props.width;
      const columns = getColumnsCount(containerWidth);
      const gap = 8;
      const itemIndex = rowIndex * columns + columnIndex;
      const item = allItems[itemIndex];

      if (!item) return <div key={key} style={style} />;

      const cellWidth = (containerWidth - (columns - 1) * gap) / columns;

      return (
        <div
          key={key}
          style={{
            ...style,
            padding: gap / 2,
          }}
        >
          {item.isCreating ? (
            <div className="bg-blue-50 dark:bg-blue-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 h-full">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => onNewFolderNameChange(e.target.value)}
                onBlur={onCancelCreateFolder}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') onConfirmCreateFolder();
                  if (e.key === 'Escape') onCancelCreateFolder();
                }}
                className="w-full px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className="flex gap-2">
                <button
                  onClick={onCancelCreateFolder}
                  className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button onClick={onConfirmCreateFolder} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                  Create
                </button>
              </div>
            </div>
          ) : (
            <div
              className="group relative bg-gray-50 dark:bg-gray-700 rounded-lg p-1 active:shadow-lg transition-shadow cursor-pointer flex flex-col h-full"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              onClick={() => item.isDirectory && deletingFile?.id !== item.id && onNavigateToFolder(item.name)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {deletingFile?.id === item.id ? (
                <div className="absolute inset-0 bg-red-50 dark:bg-red-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                  <p className="text-red-800 dark:text-red-200 font-medium text-center ">Delete {item.isDirectory ? 'folder' : 'file'}?</p>
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
                <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => onNewFileNameChange(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') onConfirmRename();
                      if (e.key === 'Escape') onCancelRename();
                    }}
                    className="w-full px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white "
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
                className={`w-full aspect-square flex items-center justify-center mb-2 bg-white dark:bg-gray-600 rounded-lg relative overflow-hidden ${
                  isImage(item.name) || isVideo(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name) || isXlsx(item.name)
                    ? 'cursor-pointer hover:opacity-90 transition-opacity'
                    : ''
                }`}
                onClick={(e) => {
                  if (isImage(item.name) || isVideo(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name) || isXlsx(item.name)) {
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
                      if (e?.target) {
                        e.target.style.display = 'none';
                      }
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
                        if (e?.target) {
                          e.target.style.display = 'none';
                        }
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-black bg-opacity-60 rounded-full p-2">
                        <FiVideo className="text-white" size={20} />
                      </div>
                    </div>
                  </div>
                )}

                {isPdf(item.name) && (
                  <LazyImage
                    src={`/api/files/thumbnail/${item.id}?path=${encodeURIComponent(currentPath)}`}
                    alt={item.name}
                    className="w-full h-full object-cover rounded-lg"
                    isThumbnail={true}
                    onError={(e) => {
                      if (e?.target) {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                )}

                {item.isDirectory && <FiFolder className="text-blue-500" size={cellWidth > 100 ? 48 : 32} />}
                {!item.isDirectory && is3dFile(item.name) && <FiBox className="text-orange-500" size={cellWidth > 100 ? 48 : 32} />}
                {!item.isDirectory && !isImage(item.name) && !isVideo(item.name) && !isPdf(item.name) && !is3dFile(item.name) && (
                  <FiFile className="text-gray-500" size={cellWidth > 100 ? 48 : 32} />
                )}
              </div>

              <div className=" font-medium text-gray-900 dark:text-white truncate px-1" title={item.displayName || item.name}>
                {item.displayName || item.name}
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 px-1 mt-auto">{item.isDirectory ? '' : formatFileSize(item.size)}</div>

              <div className="absolute top-2 right-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1">
                {(isVideo(item.name) || isImage(item.name) || isAudio(item.name) || is3dFile(item.name) || isPdf(item.name) || isXlsx(item.name)) && (
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
                    ) : isXlsx(item.name) ? (
                      <FiFile size={16} className="text-green-600 dark:text-green-400" />
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
    },
    [
      allItems,
      newFolderName,
      onNewFolderNameChange,
      onConfirmCreateFolder,
      onCancelCreateFolder,
      deletingFile,
      onCancelDelete,
      onConfirmDelete,
      renamingFile,
      newFileName,
      onNewFileNameChange,
      onConfirmRename,
      onCancelRename,
      onNavigateToFolder,
      processingFile,
      currentPath,
      onOpenMediaViewer,
      onInitiateRename,
      onHandleDownload,
      onInitiateDelete,
      formatFileSize,
    ],
  );

  return (
    <div className="w-full h-full" style={{ WebkitOverflowScrolling: 'touch' }}>
      <AutoSizer>
        {({ height, width }) => {
          const columns = getColumnsCount(width);
          const gap = 8;
          const columnWidth = (width - (columns - 1) * gap) / columns;
          const rowHeight = columnWidth + gap;
          const rowCount = Math.ceil(allItems.length / columns);

          return (
            <Grid
              ref={gridRef}
              cellRenderer={(props) => cellRenderer({ ...props, parent: { props: { width } } })}
              columnCount={columns}
              columnWidth={columnWidth + gap}
              height={height}
              rowCount={rowCount}
              rowHeight={rowHeight}
              width={width}
              overscanRowCount={1}
              style={{
                outline: 'none',
                overflowX: 'hidden',
              }}
            />
          );
        }}
      </AutoSizer>
    </div>
  );
};

export default GridView;
