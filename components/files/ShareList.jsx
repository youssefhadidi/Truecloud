/** @format */

'use client';

import { FiFolder, FiFile, FiDownload } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

export default function ShareList({
  files = [],
  onFileClick,
  onDownload,
  onContextMenu,
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
            {!file.isDirectory && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(file);
                }}
                className="p-2 text-green-400 hover:bg-green-600 rounded transition-colors"
                title="Download"
              >
                <FiDownload size={18} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
