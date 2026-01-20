/** @format */

'use client';

import { FiArrowLeft, FiChevronRight, FiVideo, FiFileText } from 'react-icons/fi';
import Viewer3D, { is3dFile } from './Viewer3D';
import { isImage, isVideo, isAudio, isPdf } from '@/lib/clientFileUtils';

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate }) {
  if (!viewerFile) return null;

  // Helper to determine file type
  const getFileType = (file) => {
    if (is3dFile(file.name)) return '3d';
    if (isImage(file.name)) return 'image';
    if (isVideo(file.name)) return 'video';
    if (isAudio(file.name)) return 'audio';
    if (isPdf(file.name)) return 'pdf';
    return null;
  };

  // Helper to check if file is HEIC
  const isHeic = (fileName) => {
    const ext = fileName.toLowerCase();
    return ext.endsWith('.heic') || ext.endsWith('.heif');
  };

  // Helper to build download URL
  const getFileUrl = (file, type) => {
    // Use conversion endpoint for HEIC files
    if (type === 'image' && isHeic(file.name)) {
      return `/api/files/convert-heic?id=${encodeURIComponent(file.id)}&path=${encodeURIComponent(currentPath)}`;
    }
    const baseUrl = `/api/files/${type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download'}/${file.id}`;
    return `${baseUrl}?path=${encodeURIComponent(currentPath)}`;
  };

  const fileType = getFileType(viewerFile);

  // Render media based on type
  const renderMedia = () => {
    const containerClass = 'max-w-full max-h-full object-contain';
    const stopProp = (e) => e.stopPropagation();

    switch (fileType) {
      case '3d':
        return <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} onClick={stopProp} />;

      case 'image':
        return <img src={getFileUrl(viewerFile, 'image')} alt={viewerFile.name} className={containerClass} onClick={stopProp} />;

      case 'video':
        return (
          <video controls autoPlay className={containerClass} src={getFileUrl(viewerFile, 'video')} onClick={stopProp}>
            Your browser does not support video playback.
          </video>
        );

      case 'audio':
        return (
          <div className="flex flex-col items-center gap-4 w-full" onClick={stopProp}>
            <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center">
              <FiVideo size={64} className="text-blue-400" />
            </div>
            <audio controls className="w-full max-w-md" src={getFileUrl(viewerFile, 'audio')}>
              Your browser does not support audio playback.
            </audio>
          </div>
        );

      case 'pdf':
        return <iframe src={getFileUrl(viewerFile, 'pdf')} className="w-full h-full" title={viewerFile.name} onClick={stopProp} />;

      default:
        return <div className="text-gray-400">Unsupported file type</div>;
    }
  };

  return (
    <div className="fixed inset-0 bg-opacity-75 flex items-center justify-center z-50 p-1" onClick={onClose} style={{ backgroundColor: '#00000082' }}>
      <div className="relative bg-gray-900 rounded-lg shadow-xl w-full max-w-[1400px] h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{viewerFile.name}</h3>
            {viewableFiles.length > 1 && (
              <p className="text-sm text-gray-400">
                {viewableFiles.findIndex((f) => f.id === viewerFile.id) + 1} / {viewableFiles.length}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl" title="Close">
            ✕
          </button>
        </div>

        {/* Media Content */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative">
          {renderMedia()}

          {/* Navigation Buttons - Only show if multiple viewable files */}
          {viewableFiles.length > 1 && (
            <>
              <button
                onClick={() => onNavigate('prev')}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all"
                title="Previous"
              >
                <FiArrowLeft size={24} />
              </button>

              <button
                onClick={() => onNavigate('next')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all"
                title="Next"
              >
                <FiChevronRight size={24} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
