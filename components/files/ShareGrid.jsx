/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiFolder, FiFile, FiVideo, FiBox, FiImage, FiEdit, FiDownload, FiTrash2, FiPlay } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

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
              <FiBox className="text-orange-400" size={40} />
            ) : isPdf(file.name) ? (
              <ShareThumbnail token={token} fileName={file.name} currentSubPath={currentSubPath} submittedPassword={submittedPassword} />
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
