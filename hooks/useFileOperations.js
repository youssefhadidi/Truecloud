/** @format */

import { useEffect } from 'react';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox } from 'react-icons/fi';
import { is3dFile, isImage, isVideo } from '@/lib/clientFileUtils';

export function useNavigation({ currentPath, pathHistory, historyIndex, setCurrentPath, setPathHistory, setHistoryIndex }) {
  const navigateToFolder = (folderName) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    // Truncate any forward history and add new path
    const newHistory = [...pathHistory.slice(0, historyIndex + 1), newPath];
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(newPath);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentPath(pathHistory[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < pathHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentPath(pathHistory[newIndex]);
    }
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < pathHistory.length - 1;

  const navigateToBreadcrumb = (index) => {
    // Build the path from breadcrumb segments
    const pathParts = currentPath ? currentPath.split('/') : [];
    const targetPath = index === 0 ? '' : pathParts.slice(0, index).join('/');

    // Truncate forward history and add this path
    const newHistory = [...pathHistory.slice(0, historyIndex + 1), targetPath];
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(targetPath);
  };

  return {
    navigateToFolder,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    navigateToBreadcrumb,
  };
}

export function useMediaViewer({ viewerFile, viewableFiles, setViewerFile }) {
  const openMediaViewer = (file) => {
    setViewerFile(file);
  };

  const closeMediaViewer = () => {
    setViewerFile(null);
  };

  const navigateViewer = (direction) => {
    if (!viewerFile || viewableFiles.length === 0) return;

    const currentIndex = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    let newIndex;

    if (direction === 'next') {
      newIndex = (currentIndex + 1) % viewableFiles.length;
    } else {
      newIndex = (currentIndex - 1 + viewableFiles.length) % viewableFiles.length;
    }

    setViewerFile(viewableFiles[newIndex]);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!viewerFile) return;

      if (e.key === 'ArrowRight') {
        navigateViewer('next');
      } else if (e.key === 'ArrowLeft') {
        navigateViewer('prev');
      } else if (e.key === 'Escape') {
        closeMediaViewer();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [viewerFile, viewableFiles]);

  return {
    openMediaViewer,
    closeMediaViewer,
    navigateViewer,
  };
}

export function useDragAndDrop({ setIsDragging }) {
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDropEvent = (e, onDrop) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    onDrop(files);
  };

  return {
    handleDragOver,
    handleDragLeave,
    handleDropEvent,
  };
}

export function useContextMenu({ setContextMenu, setSelectedContextFile }) {
  const handleContextMenu = (e, file) => {
    e.preventDefault();
    setSelectedContextFile(file);
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    setSelectedContextFile(null);
  };

  return {
    handleContextMenu,
    closeContextMenu,
  };
}

export function useFileUtils({ currentPath, folderDisplayNames }) {
  const handleDownload = (fileId, fileName) => {
    window.open(`/api/files/download/${encodeURIComponent(fileId)}?path=${encodeURIComponent(currentPath)}`, '_blank');
  };

  const getFileIcon = (file) => {
    if (file.isDirectory) return <FiFolder className="text-blue-500" size={24} />;
    if (is3dFile(file.name)) return <FiBox className="text-orange-500" size={24} />;
    if (isImage(file.name)) return <FiImage className="text-green-500" size={24} />;
    if (isVideo(file.name)) return <FiVideo className="text-purple-500" size={24} />;
    return <FiFile className="text-gray-500" size={24} />;
  };

  const getFolderDisplayName = (folderName) => {
    if (folderName.startsWith('user_')) {
      return folderDisplayNames[folderName] || folderName;
    }
    return folderName;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
    return Math.round((Number(bytes) / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return {
    handleDownload,
    getFileIcon,
    getFolderDisplayName,
    formatFileSize,
  };
}
