/** @format */

'use client';

import { useRef, useMemo, useCallback, useState, memo } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2, FiPlay, FiShare2, FiPause, FiX } from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { is3dFile } from '@/components/files/Viewer3D';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';

// Breakpoints
const BREAKPOINT = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const getColumnsCount = (width) => {
  if (width < BREAKPOINT.sm) return 3;
  if (width < BREAKPOINT.md) return 4;
  if (width < BREAKPOINT.lg) return 5;
  if (width < BREAKPOINT.xl) return 6;
  if (width < BREAKPOINT['2xl']) return 7;
  return 8;
};

// Memoized GridItem with shallow comparison
const GridItem = memo(
  ({
    item,
    cellWidth,
    containerWidth,
    style,
    gap,
    isCreating,
    newFolderName,
    onNewFolderNameChange,
    onCancelCreateFolder,
    onConfirmCreateFolder,
    isDeletingFile,
    isRenamingFile,
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
    onInitiateShare,
    sharedPath,
    onContextMenu,
    selectionMode,
    isSelected,
    onToggleSelect,
    shouldShowActions,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    setShowingActionsFor,
    onPauseDownload,
    onResumeDownload,
    onRemoveDownload,
  }) => {
    return (
      <div
        style={{
          ...style,
          padding: gap / 2,
        }}
      >
        {isCreating ? (
          <div className="bg-blue-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 h-full">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirmCreateFolder();
                if (e.key === 'Escape') onCancelCreateFolder();
              }}
              className="w-full px-2 py-1 border border-blue-700 rounded bg-gray-700 text-white"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelCreateFolder();
                }}
                className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmCreateFolder();
                }}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        ) : item.isDownloading ? (
          <div
            className="group relative bg-yellow-900/30 border border-yellow-700 rounded-lg active:shadow-lg transition-shadow flex flex-col h-full select-none"
            style={{ WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', overflow: 'clip' }}
          >
            {/* Download icon area */}
            <div className="w-full aspect-square flex items-center justify-center mb-2 bg-yellow-900/20 relative overflow-hidden rounded">
              {item.downloadStatus === 'active' ? (
                <>
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
                  <div className="w-full bg-gray-700 rounded-full h-2 mt-2 overflow-hidden">
                    <div className="bg-yellow-500 h-full transition-all" style={{ width: `${item.downloadProgress || 0}%` }} />
                  </div>
                </>
              ) : (
                <FiDownload className="text-yellow-500" size={32} />
              )}
            </div>

            {/* Download name */}
            <div className="font-medium text-white truncate px-1" title={item.name}>
              {item.name}
            </div>

            {/* Progress percentage */}
            <div className="text-xs text-yellow-300 px-1 mt-1">
              {item.downloadProgress || 0}%{item.downloadSpeed ? ` - ${item.downloadSpeed}` : ''}
            </div>

            {/* Download speed */}
            <div className="text-xs text-yellow-300 px-1 mt-2"></div>

            {/* Action buttons - pause/resume and cancel */}
            {(shouldShowActions(item.id) || containerWidth >= 640) && (
              <div
                className={`absolute top-2 right-2 flex gap-1 bg-gray-800 rounded-lg shadow-lg p-1 transition-opacity z-10 ${
                  containerWidth >= 640 ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    if (item.downloadStatus === 'paused') {
                      onResumeDownload?.(item.downloadGid);
                    } else {
                      onPauseDownload?.(item.downloadGid);
                    }
                  }}
                  className="p-1.5 text-yellow-400 hover:bg-yellow-900/20 rounded transition-colors"
                  title={item.downloadStatus === 'paused' ? 'Resume' : 'Pause'}
                >
                  {item.downloadStatus === 'paused' ? <FiPlay size={16} /> : <FiPause size={16} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    onRemoveDownload?.(item.downloadGid);
                  }}
                  className="p-1.5 text-red-400 hover:bg-red-900/20 rounded transition-colors"
                  title="Cancel"
                >
                  <FiX size={16} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="group relative bg-gray-700 rounded-lg p-0 active:shadow-lg transition-shadow cursor-pointer flex flex-col h-full select-none"
            style={{ WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', overflow: 'clip' }}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect?.(item);
                return;
              }
              if (item.isDirectory && !isDeletingFile && !shouldShowActions(item.id)) {
                onNavigateToFolder(item.name);
              }
            }}
            onContextMenu={(e) => onContextMenu?.(e, item)}
            onTouchStart={() => {
              if (!selectionMode) onTouchStart(item);
            }}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchMove}
          >
            {selectionMode && (
              <div className="absolute left-2 top-2 z-20">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect?.(item)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 rounded border-gray-500 bg-gray-800"
                />
              </div>
            )}

            {isDeletingFile ? (
              <div className="absolute inset-0 bg-red-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                <p className="text-red-200 font-medium text-center">Delete {item.isDirectory ? 'folder' : 'file'}?</p>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelDelete();
                    }}
                    className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
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
            ) : isRenamingFile ? (
              <div className="absolute inset-0 bg-blue-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => onNewFileNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onConfirmRename();
                    if (e.key === 'Escape') onCancelRename();
                  }}
                  className="w-full px-2 py-1 border border-blue-700 rounded bg-gray-700 text-white"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelRename();
                    }}
                    className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
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
              className={`w-full aspect-square flex items-center justify-center mb-2 bg-gray-600 relative overflow-hidden ${
                isViewableFile(item) ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
              }`}
              onClick={(e) => {
                if (isViewableFile(item)) {
                  e.stopPropagation();
                  onOpenMediaViewer(item);
                }
              }}
            >
              {processingFile === item.id && (
                <div className="absolute inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              )}

              {isImage(item.name) && (
                <LazyImage
                  src=""
                  alt={item.name}
                  className="w-full h-full object-cover"
                  isThumbnail={true}
                  fileId={item.id}
                  filePath={currentPath}
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
                    src=""
                    alt={item.name}
                    className="w-full h-full object-cover"
                    isThumbnail={true}
                    fileId={item.id}
                    filePath={currentPath}
                    onError={(e) => {
                      if (e?.target) {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-gray-800 bg-opacity-50 rounded-full p-3">
                      <FiPlay className="text-white" size={24} />
                    </div>
                  </div>
                </div>
              )}

              {isPdf(item.name) && (
                <LazyImage
                  src=""
                  alt={item.name}
                  className="w-full h-full object-cover"
                  isThumbnail={true}
                  fileId={item.id}
                  filePath={currentPath}
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

              {sharedPath && (
                <div className="absolute top-1 left-1 bg-green-500 rounded-full p-1 shadow-sm" title="Shared">
                  <FiShare2 size={10} className="text-white" />
                </div>
              )}
            </div>

            <div className="font-medium text-white truncate px-1" title={item.displayName || item.name}>
              {item.displayName || item.name}
            </div>

            <div className="text-xs text-gray-400 px-1 mt-auto">{item.isDirectory ? '' : formatFileSize(item.size)}</div>

            {(shouldShowActions(item.id) || containerWidth >= BREAKPOINT.sm) && (
              <div
                className={`absolute top-2 right-2 flex gap-1 bg-gray-800 rounded-lg shadow-lg p-1 transition-opacity z-10 ${
                  containerWidth >= BREAKPOINT.sm ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {isViewableFile(item) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      onOpenMediaViewer(item);
                    }}
                    className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="View"
                    disabled={processingFile === item.id}
                  >
                    {is3dFile(item.name) ? (
                      <FiBox size={16} className="text-orange-400" />
                    ) : isVideo(item.name) ? (
                      <FiVideo size={16} className="text-purple-400" />
                    ) : isImage(item.name) ? (
                      <FiImage size={16} className="text-green-400" />
                    ) : isAudio(item.name) ? (
                      <FiVideo size={16} className="text-blue-400" />
                    ) : isPdf(item.name) ? (
                      <FiFile size={16} className="text-red-400" />
                    ) : isXlsx(item.name) ? (
                      <FiFile size={16} className="text-green-400" />
                    ) : null}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    onInitiateRename(item);
                  }}
                  className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Rename"
                  disabled={processingFile === item.id}
                >
                  <FiEdit size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    onHandleDownload(item.id, item.name);
                  }}
                  className="p-1.5 text-indigo-400 hover:bg-indigo-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download"
                  disabled={processingFile === item.id}
                >
                  <FiDownload size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    onInitiateDelete(item);
                  }}
                  className="p-1.5 text-red-400 hover:bg-red-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete"
                  disabled={processingFile === item.id}
                >
                  <FiTrash2 size={16} />
                </button>
                {onInitiateShare && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      onInitiateShare(item);
                    }}
                    className="p-1.5 text-green-400 hover:bg-green-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Share"
                    disabled={processingFile === item.id}
                  >
                    <FiShare2 size={16} />
                  </button>
                )}
              </div>
            )}

            {shouldShowActions(item.id) && containerWidth < BREAKPOINT.sm && (
              <div
                className="fixed inset-0 z-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowingActionsFor(null);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  setShowingActionsFor(null);
                }}
              />
            )}
          </div>
        )}
      </div>
    );
  },
);

GridItem.displayName = 'GridItem';

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
  onInitiateShare,
  sharedPaths,
  onContextMenu,
  selectionMode,
  selectedFiles,
  onToggleSelect,
  onPauseDownload,
  onResumeDownload,
  onRemoveDownload,
}) => {
  const gridRef = useRef(null);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const longPressTimerRef = useRef(null);

  const allItems = useMemo(() => {
    const items = [...files];
    if (creatingFolder) {
      items.unshift({ id: 'new-folder', isCreating: true });
    }
    return items;
  }, [files, creatingFolder]);

  const handleTouchStart = useCallback((item) => {
    longPressTimerRef.current = setTimeout(() => {
      setShowingActionsFor(item.id);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const shouldShowActions = useCallback(
    (itemId) => {
      if (deletingFile?.id || renamingFile?.id) {
        return false;
      }
      return showingActionsFor === itemId;
    },
    [deletingFile, renamingFile, showingActionsFor],
  );

  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style, parent }) => {
      const containerWidth = parent.props.width;
      const columns = getColumnsCount(containerWidth);
      const gap = 8;
      const itemIndex = rowIndex * columns + columnIndex;
      const item = allItems[itemIndex];

      if (!item) return <div key={key} style={style} />;

      const cellWidth = style.width - gap;
      const isShared = sharedPaths?.has(`${currentPath}/${item.name}`.replace(/\/+/g, '/').replace(/^\//, ''));

      return (
        <GridItem
          key={key}
          item={item}
          cellWidth={cellWidth}
          containerWidth={containerWidth}
          style={style}
          gap={gap}
          isCreating={item.isCreating}
          newFolderName={newFolderName}
          onNewFolderNameChange={onNewFolderNameChange}
          onCancelCreateFolder={onCancelCreateFolder}
          onConfirmCreateFolder={onConfirmCreateFolder}
          isDeletingFile={deletingFile?.id === item.id}
          isRenamingFile={renamingFile?.id === item.id}
          newFileName={newFileName}
          onNewFileNameChange={onNewFileNameChange}
          onCancelRename={onCancelRename}
          onConfirmRename={onConfirmRename}
          processingFile={processingFile}
          currentPath={currentPath}
          onNavigateToFolder={onNavigateToFolder}
          onOpenMediaViewer={onOpenMediaViewer}
          onInitiateRename={onInitiateRename}
          onHandleDownload={onHandleDownload}
          onInitiateDelete={onInitiateDelete}
          onConfirmDelete={onConfirmDelete}
          onCancelDelete={onCancelDelete}
          formatFileSize={formatFileSize}
          onInitiateShare={onInitiateShare}
          sharedPath={isShared}
          onContextMenu={onContextMenu}
          selectionMode={selectionMode}
          isSelected={!!selectedFiles?.has(item.name)}
          onToggleSelect={onToggleSelect}
          shouldShowActions={shouldShowActions}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          setShowingActionsFor={setShowingActionsFor}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
          onRemoveDownload={onRemoveDownload}
        />
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
      onInitiateShare,
      formatFileSize,
      showingActionsFor,
      handleTouchStart,
      handleTouchEnd,
      handleTouchMove,
      shouldShowActions,
      sharedPaths,
      onContextMenu,
      selectionMode,
      selectedFiles,
      onToggleSelect,
    ],
  );

  return (
    <div className="w-full h-full" style={{ WebkitOverflowScrolling: 'touch' }}>
      <AutoSizer>
        {({ height, width }) => {
          const columns = getColumnsCount(width);
          const cellSize = Math.floor(width / columns);
          const textHeight = 36;
          const rowHeight = cellSize + textHeight;
          const rowCount = Math.ceil(allItems.length / columns);

          return (
            <Grid
              ref={gridRef}
              cellRenderer={(props) => cellRenderer({ ...props, parent: { props: { width } } })}
              columnCount={columns}
              columnWidth={cellSize}
              height={height}
              rowCount={rowCount}
              rowHeight={rowHeight}
              width={width}
              overscanRowCount={5}
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
