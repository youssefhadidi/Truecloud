/** @format */

'use client';

import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { List, AutoSizer } from 'react-virtualized';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2, FiShare2, FiPause, FiPlay, FiX } from 'react-icons/fi';
import { is3dFile } from '@/components/files/Viewer3D';
import { isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';

// Breakpoint for mobile detection
const MOBILE_BREAKPOINT = 768;

const ListView = forwardRef(({
  files,
  creatingFolder,
  newFolderName,
  onNewFolderNameChange,
  onCancelCreateFolder,
  onConfirmCreateFolder,
  deletingFile,
  renamingFile,
  newFileName,
  setNewFileName,
  cancelDelete,
  confirmDelete,
  cancelRename,
  confirmRename,
  processingFile,
  handleContextMenu,
  getFileIcon,
  navigateToFolder,
  formatFileSize,
  openMediaViewer,
  initiateRename,
  handleDownload,
  initiateDelete,
  initiateShare,
  sharedPaths,
  currentPath,
  selectionMode,
  selectedFiles,
  onToggleSelect,
  onPauseDownload,
  onResumeDownload,
  onRemoveDownload,
}, ref) => {
  const listRef = useRef(null);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimerRef = useRef(null);

  // Check if mobile on mount and resize
  const checkMobile = useCallback(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
  }, []);

  // Add resize listener
  useEffect(() => {
    // Check on mount
    checkMobile();

    // Add resize listener
    window.addEventListener('resize', checkMobile);

    // Cleanup
    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, [checkMobile]);

  const handleTouchStart = useCallback(
    (file) => {
      if (!isMobile) return;
      longPressTimerRef.current = setTimeout(() => {
        setShowingActionsFor(file.id);
      }, 500); // 500ms long press
    },
    [isMobile],
  );

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

  // Hide actions when delete or rename dialogs appear
  const shouldShowActions = useCallback(
    (fileId) => {
      if (deletingFile?.id || renamingFile?.id) {
        return false;
      }
      return showingActionsFor === fileId;
    },
    [deletingFile, renamingFile, showingActionsFor],
  );

  // Create all items including the creating folder
  const allItems = [...files];
  if (creatingFolder) {
    allItems.unshift({ id: 'new-folder', isCreating: true });
  }

  useImperativeHandle(ref, () => ({
    scrollToFile: (fileName) => {
      const index = allItems.findIndex((f) => f.name === fileName);
      if (index >= 0 && listRef.current) {
        listRef.current.scrollToRow(index);
      }
    },
  }), [allItems]);

  // Responsive grid: mobile shows only name and actions, desktop shows all columns
  const gridCols = 'sm:grid-cols-[1fr_150px_150px_200px] grid-cols-[1fr_100px]';

  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const file = allItems[index];

          // Render creating folder UI
          if (file.isCreating) {
            return (
              <div
                key={key}
                className="left-0 w-full px-6 py-4 bg-blue-900/20 border-b border-gray-700"
                style={style}
              >
                <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-800 rounded px-4 py-2">
                  <FiFolder className="text-blue-400" size={20} />
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => onNewFolderNameChange(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') onConfirmCreateFolder();
                      if (e.key === 'Escape') onCancelCreateFolder();
                    }}
                    className="flex-1 px-2 py-1 border border-blue-700 rounded bg-gray-700 text-white text-sm"
                    placeholder="Folder name..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={onCancelCreateFolder} className="px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                      Cancel
                    </button>
                    <button onClick={onConfirmCreateFolder} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                      Create
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          if (deletingFile?.id === file.id) {
            return (
              <div
                key={key}
                className="left-0 w-full px-6 py-4 bg-red-900/20 border-b border-gray-700"
                style={style}
              >
                <div className="flex items-center justify-between bg-red-900/20 border border-red-800 rounded px-4 py-2">
                  <span className="text-red-200 font-medium">
                    Delete {file.isDirectory ? 'folder' : 'file'} "{file.name}"?
                  </span>
                  <div className="flex gap-2">
                    <button onClick={cancelDelete} className="px-3 py-1  bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                      Cancel
                    </button>
                    <button onClick={confirmDelete} className="px-3 py-1  bg-red-600 text-white rounded hover:bg-red-700">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          if (renamingFile?.id === file.id) {
            return (
              <div
                key={key}
                className="left-0 w-full px-6 py-4 bg-blue-900/20 border-b border-gray-700"
                style={style}
              >
                <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-800 rounded px-4 py-2">
                  {getFileIcon(file)}
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') confirmRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="flex-1 px-2 py-1 border border-blue-700 rounded bg-gray-700 text-white"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={cancelRename} className="px-3 py-1  bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                      Cancel
                    </button>
                    <button onClick={confirmRename} className="px-3 py-1  bg-blue-600 text-white rounded hover:bg-blue-700">
                      Rename
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // Render downloading file
          if (file.isDownloading) {
            return (
              <div
                key={key}
                className={`left-0 w-full grid ${gridCols} gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-4 bg-yellow-900/10 border-b border-yellow-700 items-center select-none`}
                style={{
                  ...style,
                  WebkitTapHighlightColor: 'transparent',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                  position: 'relative',
                }}
              >
                {/* Progress bar at the bottom of the row */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
                  <div
                    className="h-full bg-yellow-500 transition-all"
                    style={{ width: `${file.downloadProgress || 0}%` }}
                  />
                </div>

                {/* Name and icon */}
                <div className="flex items-center gap-3 min-w-0">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={!!selectedFiles?.has(file.name)}
                      onChange={() => onToggleSelect?.(file)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-500 bg-gray-800"
                    />
                  )}
                  <div className="flex-shrink-0">
                    {file.downloadStatus === 'active' ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-yellow-500"></div>
                    ) : (
                      <FiDownload className="text-yellow-500" size={18} />
                    )}
                  </div>
                  <div className="font-medium text-yellow-300 truncate">{file.name}</div>
                </div>

                {/* Progress percentage */}
                <div className="hidden sm:block text-yellow-300 text-sm">{file.downloadProgress || 0}%</div>

                {/* Download speed */}
                <div className="hidden sm:block text-yellow-300 text-sm">{file.downloadSpeed || '0 B/s'}</div>

                {/* Action buttons - pause/resume and cancel */}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (file.downloadStatus === 'paused') {
                        onResumeDownload?.(file.downloadGid);
                      } else {
                        onPauseDownload?.(file.downloadGid);
                      }
                    }}
                    className="text-yellow-400 p-2 hover:bg-yellow-900/20 rounded"
                    title={file.downloadStatus === 'paused' ? 'Resume' : 'Pause'}
                  >
                    {file.downloadStatus === 'paused' ? (
                      <FiPlay size={18} />
                    ) : (
                      <FiPause size={18} />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveDownload?.(file.downloadGid);
                    }}
                    className="text-red-400 p-2 hover:bg-red-900/20 rounded"
                    title="Cancel"
                  >
                    <FiX size={18} />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={key}
              className={`left-0 w-full grid ${gridCols} gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-4 hover:bg-gray-700 border-b border-gray-700 items-center cursor-pointer transition-colors select-none`}
              style={{
                ...style,
                WebkitTapHighlightColor: 'transparent',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              }}
              onClick={() => {
                if (selectionMode) {
                  onToggleSelect?.(file);
                  return;
                }
                // Don't navigate if showing actions on mobile
                if (shouldShowActions(file.id)) return;

                if (file.isDirectory) {
                  navigateToFolder(file.name);
                } else if (isViewableFile(file)) {
                  openMediaViewer(file);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onTouchStart={() => {
                if (!selectionMode) handleTouchStart(file);
              }}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              <div className="flex items-center gap-3 min-w-0">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={!!selectedFiles?.has(file.name)}
                    onChange={() => onToggleSelect?.(file)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-500 bg-gray-800"
                  />
                )}
                {processingFile === file.id ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600 flex-shrink-0"></div>
                ) : (
                  <div className="flex-shrink-0 relative">
                    {getFileIcon(file)}
                    {sharedPaths?.has(`${currentPath}/${file.name}`.replace(/\/+/g, '/').replace(/^\//, '')) && (
                      <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5" title="Shared">
                        <FiShare2 size={8} className="text-white" />
                      </div>
                    )}
                  </div>
                )}
                {file.isDirectory ? (
                  <div className="font-medium text-indigo-400 truncate">{file.displayName || file.name}</div>
                ) : (
                  <div className="font-medium text-white truncate">{file.displayName || file.name}</div>
                )}
              </div>
              <div className="hidden sm:block text-gray-400">{file.isDirectory ? '' : formatFileSize(file.size)}</div>
              <div className="hidden sm:block text-gray-400">{new Date(file.updatedAt).toLocaleDateString()}</div>

              {/* Action buttons - always show on desktop, show on long press for mobile */}
              {(!isMobile || shouldShowActions(file.id)) && (
                <div className="flex justify-end gap-2 relative">
                  {isViewableFile(file) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowingActionsFor(null);
                        openMediaViewer(file);
                      }}
                      className="text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed p-2 hover:bg-purple-900/20 rounded"
                      title="View"
                      disabled={processingFile === file.id}
                    >
                      {is3dFile(file.name) ? (
                        <FiBox size={18} />
                      ) : isVideo(file.name) ? (
                        <FiVideo size={18} />
                      ) : isImage(file.name) ? (
                        <FiImage size={18} />
                      ) : isAudio(file.name) ? (
                        <FiVideo size={18} />
                      ) : isPdf(file.name) ? (
                        <FiFile size={18} />
                      ) : isXlsx(file.name) ? (
                        <FiFile size={18} />
                      ) : null}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      initiateRename(file);
                    }}
                    className="text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed p-2 hover:bg-blue-900/20 rounded"
                    title="Rename"
                    disabled={processingFile === file.id}
                  >
                    <FiEdit size={18} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      handleDownload(file.id, file.name);
                    }}
                    className="text-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed p-2 hover:bg-indigo-900/20 rounded"
                    title="Download"
                    disabled={processingFile === file.id}
                  >
                    <FiDownload size={18} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      initiateDelete(file);
                    }}
                    className="text-red-400 disabled:opacity-50 disabled:cursor-not-allowed p-2 hover:bg-red-900/20 rounded"
                    title="Delete"
                    disabled={processingFile === file.id}
                  >
                    <FiTrash2 size={18} />
                  </button>
                  {initiateShare && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowingActionsFor(null);
                        initiateShare(file);
                      }}
                      className="text-green-400 disabled:opacity-50 disabled:cursor-not-allowed p-2 hover:bg-green-900/20 rounded"
                      title="Share"
                      disabled={processingFile === file.id}
                    >
                      <FiShare2 size={18} />
                    </button>
                  )}
                </div>
              )}

              {/* Overlay to close action buttons on mobile */}
              {shouldShowActions(file.id) && isMobile && (
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
          );
    },
    [allItems, deletingFile, renamingFile, showingActionsFor, isMobile, gridCols, currentPath, sharedPaths, selectionMode, selectedFiles, processingFile, shouldShowActions, getFileIcon, navigateToFolder, isViewableFile, openMediaViewer, initiateRename, setNewFileName, cancelRename, confirmRename, handleDownload, initiateDelete, cancelDelete, confirmDelete, initiateShare, onToggleSelect, onPauseDownload, onResumeDownload, onRemoveDownload, formatFileSize],
  );

  return (
    <div className="flex-grow overflow-auto">
      <AutoSizer>
        {({ height, width }) => (
          <List
            ref={listRef}
            height={height}
            width={width}
            rowCount={allItems.length}
            rowHeight={65}
            rowRenderer={rowRenderer}
            overscanRowCount={10}
            style={{
              outline: 'none',
            }}
          />
        )}
      </AutoSizer>
    </div>
  );
});

ListView.displayName = 'ListView';

export default ListView;
