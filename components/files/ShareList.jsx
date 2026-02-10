/** @format */

'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FiFolder, FiFile, FiVideo, FiBox, FiImage, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

export default function ShareList({
  files = [],
  allowUploads = false,
  deletingFile,
  renamingFile,
  newFileName,
  setNewFileName,
  cancelDelete,
  confirmDelete,
  cancelRename,
  confirmRename,
  processingFile,
  onFileClick,
  onDownload,
  onContextMenu,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
  selectionMode,
  selectedFiles,
  onToggleSelect,
}) {
  const parentRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          const isDeleting = deletingFile?.name === file.name;
          const isRenaming = renamingFile?.name === file.name;

          if (isDeleting) {
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 w-full px-4 py-3 bg-red-900/20 border-b border-gray-700"
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
                    <button onClick={cancelDelete} className="px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                      Cancel
                    </button>
                    <button onClick={confirmDelete} className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          if (isRenaming) {
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 w-full px-4 py-3 bg-blue-900/20 border-b border-gray-700"
                style={{
                  top: 0,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-800 rounded px-4 py-2">
                  {file.isDirectory ? <FiFolder className="text-blue-400" size={20} /> : <FiFile className="text-gray-400" size={20} />}
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
                    <button onClick={cancelRename} className="px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                      Cancel
                    </button>
                    <button onClick={confirmRename} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
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
              className="absolute left-0 w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 cursor-pointer transition-colors border-b border-gray-700"
              style={{
                top: 0,
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => {
                if (selectionMode) {
                  onToggleSelect?.(file);
                  return;
                }
                onFileClick(file);
              }}
              onContextMenu={(e) => onContextMenu(e, file)}
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
                {file.isDirectory ? <FiFolder className="text-blue-400" size={24} /> : <FiFile className="text-gray-400" size={24} />}
                <div className="min-w-0">
                  <p className="font-medium text-white truncate" title={file.name}>
                    {file.name}
                  </p>
                  {!file.isDirectory && <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMediaViewer(file);
                    }}
                    className="p-2 hover:bg-gray-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="View"
                    disabled={processingFile === file.name}
                  >
                    {is3dFile(file.name) ? (
                      <FiBox size={18} className="text-orange-400" />
                    ) : isVideo(file.name) ? (
                      <FiVideo size={18} className="text-purple-400" />
                    ) : isImage(file.name) ? (
                      <FiImage size={18} className="text-green-400" />
                    ) : isPdf(file.name) ? (
                      <FiFile size={18} className="text-red-400" />
                    ) : isXlsx(file.name) ? (
                      <FiFile size={18} className="text-green-400" />
                    ) : (
                      <FiVideo size={18} className="text-blue-400" />
                    )}
                  </button>
                )}
                {allowUploads && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInitiateRename(file);
                    }}
                    className="p-2 text-blue-400 hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Rename"
                    disabled={processingFile === file.name}
                  >
                    <FiEdit size={18} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(file);
                  }}
                  className="p-2 text-indigo-400 hover:bg-indigo-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download"
                  disabled={processingFile === file.name}
                >
                  <FiDownload size={18} />
                </button>
                {allowUploads && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInitiateDelete(file);
                    }}
                    className="p-2 text-red-400 hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete"
                    disabled={processingFile === file.name}
                  >
                    <FiTrash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
