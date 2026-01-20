/** @format */

'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf } from '@/lib/clientFileUtils';

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
}) => {
  const parentRef = useRef(null);
  const [colCount, setColCount] = useState(8);

  useEffect(() => {
    const updateWidth = () => {
      if (parentRef.current) {
        const width = parentRef.current.clientWidth;

        // Calculate column count based on width
        let cols = 2;
        if (width > 1536)
          cols = 9; // xl
        else if (width > 1280)
          cols = 8; // lg
        else if (width > 768)
          cols = 5; // md
        else if (width > 640) cols = 4; // sm
        setColCount(cols);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const allItems = useMemo(() => {
    const items = [...files];
    if (creatingFolder) {
      items.unshift({ id: 'new-folder', isCreating: true });
    }
    return items;
  }, [files, creatingFolder]);

  const itemsPerRow = colCount;
  const rowCount = Math.ceil(allItems.length / itemsPerRow);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 3,
  });

  return (
    <div ref={parentRef} className="w-full h-full overflow-y-auto overflow-x-hidden">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * itemsPerRow;
          const rowItems = allItems.slice(startIndex, startIndex + itemsPerRow);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="grid gap-2 px-2" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                {rowItems.map((item) => {
                  if (item.isCreating) {
                    return (
                      <div key="new-folder" className="group relative bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 border-2 border-blue-300 dark:border-blue-700 flex flex-col">
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
                    );
                  }

                  const file = item;
                  return (
                    <div
                      key={file.id}
                      className="group relative bg-gray-50 dark:bg-gray-700 rounded-lg p-2 hover:shadow-lg transition-shadow cursor-pointer flex flex-col aspect-square"
                      onClick={() => file.isDirectory && deletingFile?.id !== file.id && onNavigateToFolder(file.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                      }}
                    >
                      {deletingFile?.id === file.id ? (
                        <div className="absolute inset-0 bg-red-50 dark:bg-red-900/90 rounded-lg p-4 flex flex-col items-center justify-center gap-3 z-10">
                          <p className="text-red-800 dark:text-red-200 font-medium text-center text-sm">Delete {file.isDirectory ? 'folder' : 'file'}?</p>
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
                      ) : renamingFile?.id === file.id ? (
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
                          isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)
                            ? 'cursor-pointer hover:opacity-90 transition-opacity'
                            : ''
                        }`}
                        onClick={(e) => {
                          if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)) {
                            e.stopPropagation();
                            onOpenMediaViewer(file);
                          }
                        }}
                      >
                        {processingFile === file.id && (
                          <div className="absolute inset-0 bg-white dark:bg-gray-600 bg-opacity-75 dark:bg-opacity-75 rounded-lg flex items-center justify-center z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                          </div>
                        )}
                        {isImage(file.name) && (
                          <LazyImage
                            src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                            alt={file.name}
                            className="w-full h-full object-cover rounded-lg"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        )}
                        {isVideo(file.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={file.name}
                              className="w-full h-full object-cover rounded-lg"
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
                        {isPdf(file.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={file.name}
                              className="w-full h-full object-cover rounded-lg"
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
                        {file.isDirectory && <FiFolder className="text-blue-500" size={48} />}
                        {!file.isDirectory && is3dFile(file.name) && <FiBox className="text-orange-500" size={48} />}
                        {!file.isDirectory && !isImage(file.name) && !isVideo(file.name) && !isPdf(file.name) && !is3dFile(file.name) && (
                          <FiFile className="text-gray-500" size={48} />
                        )}
                      </div>

                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate px-1 min-h-[20px]" title={file.displayName || file.name}>
                        {file.displayName || file.name}
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400 px-1 mt-auto">{file.size > 0 ? `${Math.round(file.size / 1024)} KB` : '0 KB'}</div>

                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1">
                        {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMediaViewer(file);
                            }}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="View"
                            disabled={processingFile === file.id}
                          >
                            {is3dFile(file.name) ? (
                              <FiBox size={16} className="text-orange-600 dark:text-orange-400" />
                            ) : isVideo(file.name) ? (
                              <FiVideo size={16} className="text-purple-600 dark:text-purple-400" />
                            ) : isImage(file.name) ? (
                              <FiImage size={16} className="text-green-600 dark:text-green-400" />
                            ) : isAudio(file.name) ? (
                              <FiVideo size={16} className="text-blue-600 dark:text-blue-400" />
                            ) : isPdf(file.name) ? (
                              <FiFile size={16} className="text-red-600 dark:text-red-400" />
                            ) : null}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onInitiateRename(file);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Rename"
                          disabled={processingFile === file.id}
                        >
                          <FiEdit size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onHandleDownload(file.id, file.name);
                          }}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Download"
                          disabled={processingFile === file.id}
                        >
                          <FiDownload size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onInitiateDelete(file);
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                          disabled={processingFile === file.id}
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GridView;
