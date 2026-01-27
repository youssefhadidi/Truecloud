/** @format */

'use client';

import { useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2, FiShare2 } from 'react-icons/fi';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';

// Breakpoint for mobile detection
const MOBILE_BREAKPOINT = 768;

const ListView = ({
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
}) => {
  const parentRef = useRef(null);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimerRef = useRef(null);

  // Check if mobile on mount and resize
  const checkMobile = useCallback(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
  }, []);

  // Add resize listener
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', checkMobile);
    if (!isMobile && window.innerWidth < MOBILE_BREAKPOINT) {
      checkMobile();
    }
  }

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

  const rowVirtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 65,
    overscan: 10,
  });

  // Responsive grid: mobile shows only name and actions, desktop shows all columns
  const gridCols = 'sm:grid-cols-[1fr_150px_150px_200px] grid-cols-[1fr_100px]';

  return (
    <div ref={parentRef} className="flex-grow overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = allItems[virtualRow.index];

          // Render creating folder UI
          if (file.isCreating) {
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 w-full px-6 py-4 bg-blue-900/20 border-b border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
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
                key={virtualRow.key}
                className="absolute left-0 w-full px-6 py-4 bg-red-900/20 border-b border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
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
                key={virtualRow.key}
                className="absolute left-0 w-full px-6 py-4 bg-blue-900/20 border-b border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
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

          return (
            <div
              key={virtualRow.key}
              className={`absolute left-0 w-full grid ${gridCols} gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-4 hover:bg-gray-700 border-b border-gray-700 items-center cursor-pointer transition-colors select-none`}
              style={{
                top: 0,
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                WebkitTapHighlightColor: 'transparent',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              }}
              onClick={() => {
                // Don't navigate if showing actions on mobile
                if (shouldShowActions(file.id)) return;

                if (file.isDirectory) {
                  navigateToFolder(file.name);
                } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) {
                  openMediaViewer(file);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onTouchStart={() => handleTouchStart(file)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              <div className="flex items-center gap-3 min-w-0">
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
                  {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
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
        })}
      </div>
    </div>
  );
};

export default ListView;
