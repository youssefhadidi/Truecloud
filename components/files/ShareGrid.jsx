/** @format */

'use client';

import { FiFolder, FiFile, FiVideo, FiBox } from 'react-icons/fi';
import { isImage, isVideo, isPdf, isAudio } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

export default function ShareGrid({
  files = [],
  token,
  submittedPassword = '',
  currentSubPath = '',
  onFileClick,
  onContextMenu,
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
              <img
                src={`/api/public/${token}/thumbnail?file=${encodeURIComponent(file.name)}&path=${encodeURIComponent(currentSubPath)}${submittedPassword ? `&pwd=${encodeURIComponent(submittedPassword)}` : ''}`}
                alt={file.name}
                className="w-full h-full object-cover"
                onError={(e) => (e.target.style.display = 'none')}
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
        </div>
      ))}
    </div>
  );
}
