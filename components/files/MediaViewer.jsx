/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiArrowLeft, FiChevronRight, FiVideo, FiFileText, FiMaximize2, FiMinimize2 } from 'react-icons/fi';
import Viewer3D, { is3dFile } from './Viewer3D';
import XlsxViewer from './XlsxViewer';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';

export default function MediaViewer({ viewerFile, viewableFiles, currentPath, onClose, onNavigate }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize fullscreen state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mediaViewerFullscreen');
      if (saved !== null) {
        setIsFullscreen(JSON.parse(saved));
      }
    }
  }, []);

  // Reset loading state when file changes
  useEffect(() => {
    setIsLoading(true);
  }, [viewerFile?.id]);

  // Save fullscreen state to localStorage
  const toggleFullscreen = () => {
    const newState = !isFullscreen;
    setIsFullscreen(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mediaViewerFullscreen', JSON.stringify(newState));
    }
  };

  if (!viewerFile) return null;

  // Helper to determine file type
  const getFileType = (file) => {
    if (is3dFile(file.name)) return '3d';
    if (isImage(file.name)) return 'image';
    if (isVideo(file.name)) return 'video';
    if (isAudio(file.name)) return 'audio';
    if (isPdf(file.name)) return 'pdf';
    if (isXlsx(file.name)) return 'xlsx';
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
    // Use optimization endpoint for images for faster loading
    if (type === 'image') {
      return `/api/files/optimize-image/${encodeURIComponent(file.id)}?path=${encodeURIComponent(currentPath)}&quality=85&w=2000&h=2000`;
    }
    const baseUrl = `/api/files/${type === 'video' || type === 'audio' || type === 'pdf' ? 'stream' : 'download'}/${file.id}`;
    return `${baseUrl}?path=${encodeURIComponent(currentPath)}`;
  };

  const fileType = getFileType(viewerFile);

  // Render media based on type
  const renderMedia = () => {
    const containerClass = 'w-full h-full object-contain';
    const stopProp = (e) => e.stopPropagation();

    switch (fileType) {
      case '3d':
        return <Viewer3D fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} onClick={stopProp} />;

      case 'image':
        return (
          <div className="relative w-full h-full flex items-center justify-center">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-50">
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
                  <p className="text-gray-300 text-sm">Loading image...</p>
                </div>
              </div>
            )}
            <img 
              src={getFileUrl(viewerFile, 'image')} 
              alt={viewerFile.name} 
              className={containerClass}
              onClick={stopProp}
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
            />
          </div>
        );

      case 'video':
        return (
          <video controls autoPlay className={containerClass} src={getFileUrl(viewerFile, 'video')} onClick={stopProp} style={{ width: '100%', height: '100%' }}>
            Your browser does not support video playback.
          </video>
        );

      case 'audio':
        return (
          <div className="flex flex-col items-center gap-4 w-full" onClick={stopProp}>
            <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center">
              <FiVideo size={64} className="text-blue-400" />
            </div>
            <audio controls className="w-full" src={getFileUrl(viewerFile, 'audio')} style={{ width: '100%' }}>
              Your browser does not support audio playback.
            </audio>
          </div>
        );

      case 'pdf':
        return <iframe src={getFileUrl(viewerFile, 'pdf')} className="w-full h-full" title={viewerFile.name} onClick={stopProp} />;

      case 'xlsx':
        return <XlsxViewer fileId={viewerFile.id} currentPath={currentPath} fileName={viewerFile.name} onClick={stopProp} />;

      default:
        return <div className="text-gray-400">Unsupported file type</div>;
    }
  };

  return (
    <div
      className={`${isFullscreen ? 'fixed inset-0 z-50' : 'fixed inset-0 bg-opacity-75 flex items-center justify-center z-50 p-1'}`}
      onClick={isFullscreen ? null : onClose}
      style={isFullscreen ? {} : { backgroundColor: '#00000082' }}
    >
      <div
        className={`${isFullscreen ? 'w-screen h-screen rounded-none' : 'relative bg-gray-900 rounded-lg shadow-xl w-full max-w-[1600px] h-[90vh]'} bg-gray-900 flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{viewerFile.name}</h3>
            {viewableFiles.length > 1 && (
              <p className=" text-gray-400">
                {viewableFiles.findIndex((f) => f.id === viewerFile.id) + 1} / {viewableFiles.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700">
            <button
              onClick={toggleFullscreen}
              className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md border-r border-gray-700 last:border-r-0"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <FiMinimize2 size={18} /> : <FiMaximize2 size={18} />}
            </button>
            <button onClick={onClose} className="px-3 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors first:rounded-l-md last:rounded-r-md" title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Media Content */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-1 relative">
          {renderMedia()}

          {/* Navigation Buttons - Only show if multiple viewable files */}
          {viewableFiles.length > 1 && (
            <>
              <button
                onClick={() => onNavigate('prev')}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all"
                title="Previous"
                style={{ zIndex: 50 }}
              >
                <FiArrowLeft size={24} />
              </button>

              <button
                onClick={() => onNavigate('next')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full p-3 transition-all"
                title="Next"
                style={{ zIndex: 50 }}
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
