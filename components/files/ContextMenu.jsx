/** @format */

'use client';

import { FiFolder, FiEdit, FiDownload, FiVideo, FiImage, FiTrash2, FiBox } from 'react-icons/fi';
import { isImage, isVideo, isAudio } from '@/lib/clientFileUtils';
import { is3dFile } from './Viewer3D';

export default function ContextMenu({ contextMenu, file, onNavigateToFolder, onRename, onDownload, onView, onDelete, onClose }) {
  if (!contextMenu || !file) return null;

  return (
    <div
      className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50 min-w-[200px]"
      style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      {file.isDirectory ? (
        <>
          <button
            onClick={onNavigateToFolder}
            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300"
          >
            <FiFolder size={16} />
            Open Folder
          </button>
          <button onClick={onRename} className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FiEdit size={16} />
            Rename
          </button>
          <button onClick={onDownload} className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FiDownload size={16} />
            Download as ZIP
          </button>
        </>
      ) : (
        <>
          <button onClick={onDownload} className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FiDownload size={16} />
            Download
          </button>
          <button onClick={onRename} className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FiEdit size={16} />
            Rename
          </button>
          {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name)) && (
            <button onClick={onView} className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300">
              {is3dFile(file.name) && <FiBox size={16} />}
              {isVideo(file.name) && <FiVideo size={16} />}
              {isImage(file.name) && <FiImage size={16} />}
              {isAudio(file.name) && <FiVideo size={16} />}
              View
            </button>
          )}
        </>
      )}
      <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
      <button onClick={onDelete} className="w-full px-4 py-2 text-left hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 text-red-600 dark:text-red-400">
        <FiTrash2 size={16} />
        Delete
      </button>
    </div>
  );
}
