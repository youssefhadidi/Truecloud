/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { FiFolder, FiFile, FiVideo, FiBox, FiImage, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

function ShareThumbnail({ token, fileName, currentSubPath, submittedPassword }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);
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

  useEffect(() => {
    if (!isInView) return;
    const url = `/api/public/${token}/thumbnail?file=${encodeURIComponent(fileName)}&path=${encodeURIComponent(currentSubPath)}${submittedPassword ? `&pwd=${encodeURIComponent(submittedPassword)}` : ''}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.data) setSrc(data.data);
        else setError(true);
      })
      .catch(() => setError(true));
  }, [isInView, token, fileName, currentSubPath, submittedPassword]);

  if (error) return null;

  return (
    <div ref={ref} className="w-full h-full">
      {src && <img src={src} alt={fileName} className="w-full h-full object-cover" />}
      {!src && isInView && !error && (
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
  onFileClick,
  onContextMenu,
  onDownload,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {files.map((file) => (
        <div
          key={file.name}
          className="group relative bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-600 transition-colors"
          onClick={() => onFileClick(file)}
          onContextMenu={(e) => onContextMenu(e, file)}
        >
          <div className="aspect-square flex items-center justify-center bg-gray-600 rounded-lg mb-2 overflow-hidden">
            {file.isDirectory ? (
              <FiFolder className="text-blue-400" size={40} />
            ) : isImage(file.name) ? (
              <ShareThumbnail
                token={token}
                fileName={file.name}
                currentSubPath={currentSubPath}
                submittedPassword={submittedPassword}
              />
            ) : isVideo(file.name) ? (
              <FiVideo className="text-purple-400" size={40} />
            ) : is3dFile(file.name) ? (
              <FiBox className="text-orange-400" size={40} />
            ) : isPdf(file.name) ? (
              <FiFile className="text-red-400" size={40} />
            ) : (
              <FiFile className="text-gray-400" size={40} />
            )}
          </div>
          <p className="text-sm font-medium text-white truncate" title={file.name}>
            {file.name}
          </p>
          {!file.isDirectory && <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>}

          {/* Action buttons - show on hover */}
          <div
            className="absolute top-2 right-2 flex gap-1 bg-gray-800 rounded-lg shadow-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMediaViewer(file);
                }}
                className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                title="View"
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
                  onInitiateRename(file);
                }}
                className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded transition-colors"
                title="Rename"
              >
                <FiEdit size={16} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(file);
              }}
              className="p-1.5 text-indigo-400 hover:bg-indigo-900/20 rounded transition-colors"
              title="Download"
            >
              <FiDownload size={16} />
            </button>
            {allowUploads && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInitiateDelete(file);
                }}
                className="p-1.5 text-red-400 hover:bg-red-900/20 rounded transition-colors"
                title="Delete"
              >
                <FiTrash2 size={16} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
