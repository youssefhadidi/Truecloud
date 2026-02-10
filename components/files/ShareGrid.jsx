/** @format */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid, AutoSizer } from 'react-virtualized';
import { FiFolder, FiFile, FiVideo, FiBox, FiImage, FiEdit, FiDownload, FiTrash2, FiPlay } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

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

function ShareThumbnail({ token, fileName, currentSubPath, submittedPassword }) {
  const ref = useRef(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px', threshold: 0.01 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const { data, isError } = useQuery({
    queryKey: ['share-thumbnail', token, fileName, currentSubPath],
    queryFn: async () => {
      const url = `/api/public/${token}/thumbnail?file=${encodeURIComponent(fileName)}&path=${encodeURIComponent(currentSubPath)}${submittedPassword ? `&pwd=${encodeURIComponent(submittedPassword)}` : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error('No thumbnail');
      return json;
    },
    enabled: isInView,
    retry: 1,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (isError) return null;

  return (
    <div ref={ref} className="w-full h-full">
      {data?.data && <img src={data.data} alt={fileName} className="w-full h-full object-cover" />}
      {!data?.data && isInView && !isError && (
        <div className="w-full h-full flex items-center justify-center">
          <FiImage className="text-gray-400 animate-spin" size={24} />
        </div>
      )}
    </div>
  );
}

export default function ShareGrid({
  files = [],
  token,
  submittedPassword = '',
  currentSubPath = '',
  allowUploads = false,
  deletingFile,
  renamingFile,
  newFileName,
  onNewFileNameChange,
  onCancelRename,
  onConfirmRename,
  onCancelDelete,
  onConfirmDelete,
  processingFile,
  onFileClick,
  onContextMenu,
  onDownload,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
}) {
  const gridRef = useRef(null);
  const [showingActionsFor, setShowingActionsFor] = useState(null);
  const longPressTimerRef = useRef(null);

  const handleTouchStart = useCallback((file) => {
    longPressTimerRef.current = setTimeout(() => {
      setShowingActionsFor(file.name);
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
    (fileName) => {
      if (deletingFile?.name || renamingFile?.name) {
        return false;
      }
      return showingActionsFor === fileName;
    },
    [deletingFile, renamingFile, showingActionsFor],
  );

  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style, parent }) => {
      const containerWidth = parent.props.width;
      const columns = getColumnsCount(containerWidth);
      const gap = 8;
      const itemIndex = rowIndex * columns + columnIndex;
      const file = files[itemIndex];

      if (!file) return <div key={key} style={style} />;

      const cellWidth = style.width - gap;
      const isDeleting = deletingFile?.name === file.name;
      const isRenaming = renamingFile?.name === file.name;

      return (
        <div
          key={key}
          style={{
            ...style,
            padding: gap / 2,
          }}
        >
          <div
            className="group relative bg-gray-700 rounded-lg p-1 cursor-pointer hover:bg-gray-600 transition-colors h-full"
            onClick={() => {
              if (isDeleting || isRenaming || shouldShowActions(file.name)) return;
              onFileClick(file);
            }}
            onContextMenu={(e) => onContextMenu(e, file)}
            onTouchStart={() => handleTouchStart(file)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          >
            {isDeleting && (
              <div className="absolute inset-0 bg-red-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                <p className="text-red-200 font-medium text-center">Delete {file.isDirectory ? 'folder' : 'file'}?</p>
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
            )}

            {isRenaming && (
              <div className="absolute inset-0 bg-blue-900/90 rounded-lg p-3 flex flex-col items-center justify-center gap-2 z-10">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => onNewFileNameChange(e.target.value)}
                  onKeyPress={(e) => {
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
            )}

            <div className="aspect-square flex items-center justify-center bg-gray-600 rounded-lg mb-2 overflow-hidden">
              {processingFile === file.name && (
                <div className="absolute inset-0 bg-gray-700/70 rounded-lg flex items-center justify-center z-10">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                </div>
              )}

              {file.isDirectory ? (
                <FiFolder className="text-blue-400" size={cellWidth > 120 ? 48 : 36} />
              ) : isImage(file.name) ? (
                <ShareThumbnail token={token} fileName={file.name} currentSubPath={currentSubPath} submittedPassword={submittedPassword} />
              ) : isVideo(file.name) ? (
                <div className="relative w-full h-full">
                  <ShareThumbnail token={token} fileName={file.name} currentSubPath={currentSubPath} submittedPassword={submittedPassword} />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-gray-800/50 rounded-full p-3">
                      <FiPlay className="text-white" size={24} />
                    </div>
                  </div>
                </div>
              ) : is3dFile(file.name) ? (
                <FiBox className="text-orange-400" size={cellWidth > 120 ? 48 : 36} />
              ) : isPdf(file.name) ? (
                <ShareThumbnail token={token} fileName={file.name} currentSubPath={currentSubPath} submittedPassword={submittedPassword} />
              ) : (
                <FiFile className="text-gray-400" size={cellWidth > 120 ? 48 : 36} />
              )}
            </div>

            <p className="text-sm font-medium text-white truncate" title={file.name}>
              {file.name}
            </p>
            {!file.isDirectory && <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>}

            {(shouldShowActions(file.name) || containerWidth >= BREAKPOINT.sm) && (
              <div
                className={`absolute top-2 right-2 flex gap-1 bg-gray-800 rounded-lg shadow-lg p-1 transition-opacity z-10 ${
                  containerWidth >= BREAKPOINT.sm ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      onOpenMediaViewer(file);
                    }}
                    className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="View"
                    disabled={processingFile === file.name}
                  >
                    {is3dFile(file.name) ? (
                      <FiBox size={16} className="text-orange-400" />
                    ) : isVideo(file.name) ? (
                      <FiVideo size={16} className="text-purple-400" />
                    ) : isImage(file.name) ? (
                      <FiImage size={16} className="text-green-400" />
                    ) : isPdf(file.name) ? (
                      <FiFile size={16} className="text-red-400" />
                    ) : isXlsx(file.name) ? (
                      <FiFile size={16} className="text-green-400" />
                    ) : (
                      <FiVideo size={16} className="text-blue-400" />
                    )}
                  </button>
                )}
                {allowUploads && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      onInitiateRename(file);
                    }}
                    className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Rename"
                    disabled={processingFile === file.name}
                  >
                    <FiEdit size={16} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowingActionsFor(null);
                    onDownload(file);
                  }}
                  className="p-1.5 text-indigo-400 hover:bg-indigo-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download"
                  disabled={processingFile === file.name}
                >
                  <FiDownload size={16} />
                </button>
                {allowUploads && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowingActionsFor(null);
                      onInitiateDelete(file);
                    }}
                    className="p-1.5 text-red-400 hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete"
                    disabled={processingFile === file.name}
                  >
                    <FiTrash2 size={16} />
                  </button>
                )}
              </div>
            )}

            {shouldShowActions(file.name) && containerWidth < BREAKPOINT.sm && (
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
        </div>
      );
    },
    [
      files,
      token,
      submittedPassword,
      currentSubPath,
      allowUploads,
      deletingFile,
      renamingFile,
      newFileName,
      onNewFileNameChange,
      onCancelRename,
      onConfirmRename,
      onCancelDelete,
      onConfirmDelete,
      processingFile,
      onFileClick,
      onContextMenu,
      onDownload,
      onInitiateRename,
      onInitiateDelete,
      onOpenMediaViewer,
      formatFileSize,
      handleTouchStart,
      handleTouchEnd,
      handleTouchMove,
      shouldShowActions,
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
          const rowCount = Math.ceil(files.length / columns);

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
}
