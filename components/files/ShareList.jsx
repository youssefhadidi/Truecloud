/** @format */

'use client';

import { FiFolder, FiFile, FiVideo, FiBox, FiImage, FiEdit, FiDownload, FiTrash2 } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

export default function ShareList({
  files = [],
  allowUploads = false,
  onFileClick,
  onDownload,
  onContextMenu,
  onInitiateRename,
  onInitiateDelete,
  onOpenMediaViewer,
  formatFileSize,
}) {
  return (
    <div className="divide-y divide-gray-700">
      {files.map((file) => (
        <div
          key={file.name}
          className="flex items-center justify-between px-4 py-3 hover:bg-gray-700 cursor-pointer transition-colors"
          onClick={() => onFileClick(file)}
          onContextMenu={(e) => onContextMenu(e, file)}
        >
          <div className="flex items-center gap-3">
            {file.isDirectory ? (
              <FiFolder className="text-blue-400" size={24} />
            ) : (
              <FiFile className="text-gray-400" size={24} />
            )}
            <div>
              <p className="font-medium text-white">{file.name}</p>
              {!file.isDirectory && (
                <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name) || isXlsx(file.name)) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMediaViewer(file);
                }}
                className="p-2 hover:bg-gray-600 rounded transition-colors"
                title="View"
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
                className="p-2 text-blue-400 hover:bg-blue-900/20 rounded transition-colors"
                title="Rename"
              >
                <FiEdit size={18} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(file);
              }}
              className="p-2 text-indigo-400 hover:bg-indigo-900/20 rounded transition-colors"
              title="Download"
            >
              <FiDownload size={18} />
            </button>
            {allowUploads && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInitiateDelete(file);
                }}
                className="p-2 text-red-400 hover:bg-red-900/20 rounded transition-colors"
                title="Delete"
              >
                <FiTrash2 size={18} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
