/** @format */

'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';

const ListView = ({
  files,
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
}) => {
  const parentRef = useRef(null);

  const rowVirtualizer = useVirtualizer({
    count: files.length,
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
          const file = files[virtualRow.index];

          if (deletingFile?.id === file.id) {
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 w-full px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-gray-200 dark:border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-4 py-2">
                  <span className="text-red-800 dark:text-red-200 font-medium">
                    Delete {file.isDirectory ? 'folder' : 'file'} "{file.name}"?
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={cancelDelete}
                      className="px-3 py-1  bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                    >
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
                className="absolute left-0 w-full px-6 py-4 bg-blue-50 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-4 py-2">
                  {getFileIcon(file)}
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') confirmRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="flex-1 px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={cancelRename}
                      className="px-3 py-1  bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                    >
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
              className={`absolute left-0 w-full grid ${gridCols} gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-4 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700 items-center cursor-pointer transition-colors`}
              onClick={() => {
                if (file.isDirectory) {
                  navigateToFolder(file.name);
                } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) {
                  openMediaViewer(file);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, file)}
              style={{
                top: 0,
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {processingFile === file.id ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600 flex-shrink-0"></div>
                ) : (
                  <div className="flex-shrink-0">{getFileIcon(file)}</div>
                )}
                {file.isDirectory ? (
                  <div className="font-medium text-indigo-600 dark:text-indigo-400 truncate">{file.displayName || file.name}</div>
                ) : (
                  <div className="font-medium text-gray-900 dark:text-white truncate">{file.displayName || file.name}</div>
                )}
              </div>
              <div className="hidden sm:block text-gray-500 dark:text-gray-400">{file.isDirectory ? '' : formatFileSize(file.size)}</div>
              <div className="hidden sm:block text-gray-500 dark:text-gray-400">{new Date(file.updatedAt).toLocaleDateString()}</div>
              <div className="flex justify-end gap-2">
                {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
                  <button
                    onClick={() => openMediaViewer(file)}
                    className="text-purple-600 hover:text-purple-900 dark:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  onClick={() => initiateRename(file)}
                  className="text-blue-600 hover:text-blue-900 dark:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Rename"
                  disabled={processingFile === file.id}
                >
                  <FiEdit size={18} />
                </button>
                <button
                  onClick={() => handleDownload(file.id, file.name)}
                  className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download"
                  disabled={processingFile === file.id}
                >
                  <FiDownload size={18} />
                </button>
                <button
                  onClick={() => initiateDelete(file)}
                  className="text-red-600 hover:text-red-900 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete"
                  disabled={processingFile === file.id}
                >
                  <FiTrash2 size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ListView;
