/** @format */

import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FiFolder, FiFile, FiImage, FiVideo, FiBox } from 'react-icons/fi';
import { is3dFile, isImage, isVideo } from '@/lib/clientFileUtils';

/**
 * useShareOperations - File and folder operations for public shares
 * Mirrors useFileHandlers.js + useFileOperations.js patterns
 */
export function useShareOperations({
  token,
  sharePassword,
  currentSubPath,
  setCurrentSubPath,
  setPathHistory,
  setHistoryIndex,
  pathHistory,
  historyIndex,
  setCreatingFolder,
  setNewFolderName,
  newFolderName,
  setDeletingFile,
  setRenamingFile,
  setNewFileName,
  setProcessingFile,
  setViewerFile,
  viewerFile,
  viewableFiles,
  setContextMenu,
  setSelectedContextFile,
  setUploadingFiles,
  addNotification,
  allowUploads,
  setIsDragging,
}) {
  const queryClient = useQueryClient();

  const refreshListing = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    queryClient.invalidateQueries({ queryKey: ['share', token] });
  }, [queryClient, token]);

  // ============ Folder Creation ============
  const initiateCreateFolder = useCallback(() => {
    if (!allowUploads) {
      addNotification('error', 'Uploads are not allowed for this share');
      return;
    }
    setCreatingFolder(true);
    setNewFolderName('New Folder');
  }, [allowUploads, setCreatingFolder, setNewFolderName, addNotification]);

  const cancelCreateFolder = useCallback(() => {
    setCreatingFolder(false);
    setNewFolderName('');
  }, [setCreatingFolder, setNewFolderName]);

  const confirmCreateFolder = useCallback(
    async (folderNameParam) => {
      const folderName = folderNameParam || newFolderName;
      if (!folderName || !folderName.trim()) {
        cancelCreateFolder();
        return;
      }

      setProcessingFile('creating-folder');
      try {
        const response = await fetch(`/api/public/${token}/mkdir`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sharePassword && { 'x-share-password': sharePassword }),
          },
          body: JSON.stringify({
            name: folderName,
            path: currentSubPath,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create folder');
        }

        setCreatingFolder(false);
        setNewFolderName('');
        setProcessingFile(null);
        addNotification('success', 'Folder created successfully');

        refreshListing();
      } catch (error) {
        console.error('Create folder error:', error);
        addNotification('error', error.message || 'Failed to create folder', 'Error');
        setProcessingFile(null);
      }
    },
    [token, sharePassword, currentSubPath, newFolderName, setCreatingFolder, setNewFolderName, setProcessingFile, addNotification, cancelCreateFolder, refreshListing],
  );

  // ============ File Deletion ============
  const initiateDelete = useCallback(
    (file, closeContextMenu) => {
      if (!file || !file.name) {
        console.error('initiateDelete: Invalid file object', file);
        addNotification('error', 'Cannot delete: Invalid file data');
        return;
      }
      setDeletingFile(file);
      if (closeContextMenu) closeContextMenu();
    },
    [setDeletingFile, addNotification],
  );

  const cancelDelete = useCallback(() => {
    setDeletingFile(null);
  }, [setDeletingFile]);

  const confirmDelete = useCallback(
    async (deletingFile) => {
      if (!deletingFile || !deletingFile.name) {
        console.error('confirmDelete: Invalid file object', deletingFile);
        addNotification('error', 'Cannot delete file: Invalid file data');
        setDeletingFile(null);
        return;
      }

      setProcessingFile(deletingFile.name);
      try {
        const params = new URLSearchParams();
        params.append('file', deletingFile.name);
        if (currentSubPath) {
          params.append('path', currentSubPath);
        }

        const response = await fetch(`/api/public/${token}/delete?${params.toString()}`, {
          method: 'DELETE',
          headers: {
            ...(sharePassword && { 'x-share-password': sharePassword }),
          },
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete file');
        }

        setDeletingFile(null);
        setProcessingFile(null);
        addNotification('success', deletingFile.isDirectory ? 'Folder deleted' : 'File deleted');

        refreshListing();
      } catch (error) {
        console.error('Delete error:', error);
        addNotification('error', error.message || 'Failed to delete file', 'Delete Error');
        setDeletingFile(null);
        setProcessingFile(null);
      }
    },
    [token, sharePassword, currentSubPath, setDeletingFile, setProcessingFile, addNotification, refreshListing],
  );

  // ============ File Rename ============
  const initiateRename = useCallback(
    (file, closeContextMenu) => {
      if (!file || !file.name) {
        console.error('initiateRename: Invalid file object', file);
        addNotification('error', 'Cannot rename: Invalid file data');
        return;
      }
      setRenamingFile(file);
      setNewFileName(file.name);
      if (closeContextMenu) closeContextMenu();
    },
    [setRenamingFile, setNewFileName, addNotification],
  );

  const cancelRename = useCallback(() => {
    setRenamingFile(null);
    setNewFileName('');
  }, [setRenamingFile, setNewFileName]);

  const confirmRename = useCallback(
    async (renamingFile, newFileName) => {
      if (!renamingFile || !renamingFile.name) {
        console.error('confirmRename: Invalid file object', renamingFile);
        addNotification('error', 'Cannot rename file: Invalid file data');
        setRenamingFile(null);
        setNewFileName('');
        return;
      }
      if (!newFileName.trim() || newFileName === renamingFile.name) {
        cancelRename();
        return;
      }

      setProcessingFile(renamingFile.name);
      try {
        const response = await fetch(`/api/public/${token}/rename`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(sharePassword && { 'x-share-password': sharePassword }),
          },
          body: JSON.stringify({
            oldName: renamingFile.name,
            newName: newFileName,
            path: currentSubPath,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to rename file');
        }

        setRenamingFile(null);
        setNewFileName('');
        setProcessingFile(null);
        addNotification('success', 'File renamed successfully');

        refreshListing();
      } catch (error) {
        console.error('Rename error:', error);
        addNotification('error', error.message || 'Failed to rename file', 'Rename Error');
        setRenamingFile(null);
        setProcessingFile(null);
      }
    },
    [token, sharePassword, currentSubPath, setRenamingFile, setNewFileName, setProcessingFile, addNotification, cancelRename, refreshListing],
  );

  // ============ Move Files/Folders ============
  const moveFiles = useCallback(
    async (items, destinationPath) => {
      if (!allowUploads) {
        addNotification('error', 'Uploads are not allowed for this share');
        return false;
      }

      if (!items || items.length === 0) {
        addNotification('error', 'No items selected');
        return false;
      }

      setProcessingFile('moving');
      try {
        const response = await fetch(`/api/public/${token}/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sharePassword && { 'x-share-password': sharePassword }),
          },
          body: JSON.stringify({
            items,
            sourcePath: currentSubPath,
            destinationPath,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to move items');
        }

        setProcessingFile(null);
        addNotification('success', `Moved ${items.length} item(s)`);
        refreshListing();
        return true;
      } catch (error) {
        console.error('Move error:', error);
        addNotification('error', error.message || 'Failed to move items', 'Move Error');
        setProcessingFile(null);
        return false;
      }
    },
    [token, sharePassword, currentSubPath, allowUploads, setProcessingFile, addNotification, refreshListing],
  );

  // ============ File Upload ============
  const handleUpload = useCallback(
    async (files) => {
      if (!allowUploads) {
        addNotification('error', 'Uploads are not allowed for this share');
        return;
      }

      for (const file of files) {
        const uploadId = Date.now() + Math.random();

        setUploadingFiles((prev) => [
          ...prev,
          {
            id: uploadId,
            fileName: file.name,
            progress: 0,
            status: 'uploading',
          },
        ]);

        try {
          const formData = new FormData();
          formData.append('file', file);

          const params = new URLSearchParams();
          if (currentSubPath) {
            params.append('path', currentSubPath);
          }

          const response = await fetch(`/api/public/${token}/upload?${params.toString()}`, {
            method: 'POST',
            headers: {
              ...(sharePassword && { 'x-share-password': sharePassword }),
            },
            body: formData,
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
          }

          setUploadingFiles((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'success', progress: 100 } : u)));

          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((u) => u.id !== uploadId));
          }, 2000);

          addNotification('success', `${file.name} uploaded`);

          refreshListing();
        } catch (error) {
          console.error('Upload error:', error);
          setUploadingFiles((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'error', error: error.message } : u)));
          addNotification('error', `Upload failed for ${file.name}`, 'Upload Error');
        }
      }
    },
    [token, sharePassword, currentSubPath, allowUploads, setUploadingFiles, addNotification, refreshListing],
  );

  const handleUploadFromInput = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await handleUpload(files);
    },
    [handleUpload],
  );

  // ============ Download ============
  const handleDownload = useCallback(
    (file) => {
      if (!file || !file.name) return;

      // Construct the path parameter: subdirectory/filename
      const filePath = currentSubPath ? `${currentSubPath}/${file.name}` : file.name;

      const params = new URLSearchParams();
      params.append('path', filePath);
      if (sharePassword) {
        params.append('pwd', sharePassword);
      }

      // Construct download URL - for shares, we need to download via the public API
      window.open(`/api/public/${token}/download?${params.toString()}`, '_blank');
    },
    [token, sharePassword, currentSubPath],
  );

  // ============ Navigation ============
  const navigateToSubFolder = useCallback(
    (folderName) => {
      const newPath = currentSubPath ? `${currentSubPath}/${folderName}` : folderName;
      // Truncate any forward history and add new path
      const newHistory = [...pathHistory.slice(0, historyIndex + 1), newPath];
      setPathHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentSubPath(newPath);
    },
    [currentSubPath, pathHistory, historyIndex, setPathHistory, setHistoryIndex, setCurrentSubPath],
  );

  const navigateUp = useCallback(() => {
    if (!currentSubPath) return;
    const parts = currentSubPath.split('/');
    const newPath = parts.slice(0, -1).join('/');
    const newHistory = [...pathHistory.slice(0, historyIndex + 1), newPath];
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentSubPath(newPath);
  }, [currentSubPath, pathHistory, historyIndex, setPathHistory, setHistoryIndex, setCurrentSubPath]);

  const navigateToBreadcrumb = useCallback(
    (index) => {
      const pathParts = currentSubPath ? currentSubPath.split('/') : [];
      const targetPath = index === 0 ? '' : pathParts.slice(0, index).join('/');

      const newHistory = [...pathHistory.slice(0, historyIndex + 1), targetPath];
      setPathHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentSubPath(targetPath);
    },
    [currentSubPath, pathHistory, historyIndex, setPathHistory, setHistoryIndex, setCurrentSubPath],
  );

  // ============ Media Viewer ============
  const openMediaViewer = useCallback(
    (file) => {
      setViewerFile(file);
    },
    [setViewerFile],
  );

  const selectViewerFile = useCallback(
    (file) => {
      setViewerFile(file);
    },
    [setViewerFile],
  );

  const closeMediaViewer = useCallback(() => {
    setViewerFile(null);
  }, [setViewerFile]);

  const navigateViewer = useCallback(
    (direction) => {
      if (!viewerFile || viewableFiles.length === 0) return;

      const currentIndex = viewableFiles.findIndex((f) => f.name === viewerFile.name);
      let newIndex;

      if (direction === 'next') {
        newIndex = currentIndex + 1;
      } else {
        newIndex = currentIndex - 1;
      }

      // Clamp at boundaries instead of wrapping
      if (newIndex < 0 || newIndex >= viewableFiles.length) return;

      setViewerFile(viewableFiles[newIndex]);
    },
    [viewerFile, viewableFiles, setViewerFile],
  );

  // Keyboard navigation for media viewer
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
  }, [viewerFile, viewableFiles, navigateViewer, closeMediaViewer]);

  // ============ Drag & Drop ============
  const handleDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!allowUploads) return;
      setIsDragging(true);
    },
    [allowUploads, setIsDragging],
  );

  const handleDragLeave = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!allowUploads) return;
      if (e.currentTarget === e.target) {
        setIsDragging(false);
      }
    },
    [allowUploads, setIsDragging],
  );

  const handleDropEvent = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (!allowUploads) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      handleUpload(files);
    },
    [handleUpload, allowUploads, setIsDragging],
  );

  // ============ Context Menu ============
  const handleContextMenu = useCallback(
    (e, file) => {
      e.preventDefault();
      setSelectedContextFile(file);
      setContextMenu({
        x: e.pageX,
        y: e.pageY,
      });
    },
    [setContextMenu, setSelectedContextFile],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setSelectedContextFile(null);
  }, [setContextMenu, setSelectedContextFile]);

  // ============ Utilities ============
  const getFileIcon = useCallback((file) => {
    if (file.isDirectory) return <FiFolder className="text-blue-500" size={24} />;
    if (is3dFile(file.name)) return <FiBox className="text-orange-500" size={24} />;
    if (isImage(file.name)) return <FiImage className="text-green-500" size={24} />;
    if (isVideo(file.name)) return <FiVideo className="text-purple-500" size={24} />;
    return <FiFile className="text-gray-500" size={24} />;
  }, []);

  const formatFileSize = useCallback((bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
    return Math.round((Number(bytes) / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }, []);

  return {
    // Folder operations
    initiateCreateFolder,
    cancelCreateFolder,
    confirmCreateFolder,

    // Delete operations
    initiateDelete,
    cancelDelete,
    confirmDelete,

    // Rename operations
    initiateRename,
    cancelRename,
    confirmRename,

    // Upload operations
    handleUpload,
    handleUploadFromInput,

    // Move operations
    moveFiles,

    // Download operations
    handleDownload,

    // Navigation
    navigateToSubFolder,
    navigateUp,
    navigateToBreadcrumb,

    // Media viewer
    openMediaViewer,
    closeMediaViewer,
    navigateViewer,
    selectViewerFile,

    // Drag & drop
    handleDragOver,
    handleDragLeave,
    handleDropEvent,

    // Context menu
    handleContextMenu,
    closeContextMenu,

    // Utilities
    getFileIcon,
    formatFileSize,
  };
}
