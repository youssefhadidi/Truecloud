/** @format */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useFiles, useCreateFolder, useUploadFile, useDeleteFile, useRenameFile } from '@/lib/api/files';

export function useFilesPage(status) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // UI State
  const [uploading, setUploading] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState(['']);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('fileViewMode') || 'grid';
    }
    return 'grid';
  });
  const [sortBy, setSortBy] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('fileSortBy') || 'name-asc';
    }
    return 'name-asc';
  });
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedContextFile, setSelectedContextFile] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const [renamingFile, setRenamingFile] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [processingFile, setProcessingFile] = useState(null);
  const [viewerFile, setViewerFile] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [folderDisplayNames, setFolderDisplayNames] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Redirect if unauthenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Notification helpers
  const addNotification = (type, message, title = null) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [
      ...prev,
      {
        id,
        type,
        message,
        title,
        autoDismiss: true,
        duration: 5000,
      },
    ]);
  };

  const dismissNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // Persist preferences to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('fileViewMode', viewMode);
    }
  }, [viewMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('fileSortBy', sortBy);
    }
  }, [sortBy]);

  // Fetch and sort files
  const { data: filesData, isLoading } = useFiles(currentPath, status === 'authenticated');
  const files = useMemo(() => {
    // Filter out hidden files
    let filtered = (filesData || []).filter((f) => !f.name.startsWith('.'));

    // Apply search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.trim();

      // Check if it's a glob pattern (contains * or ?)
      const isGlobPattern = query.includes('*') || query.includes('?');

      if (isGlobPattern) {
        // Convert glob pattern to regex
        const regexPattern = query
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');

        try {
          const regex = new RegExp(regexPattern, 'i');
          filtered = filtered.filter((file) => regex.test(file.name));
        } catch (e) {
          // Invalid regex, fall back to simple substring match
          const lowerQuery = query.toLowerCase();
          filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
        }
      } else {
        // Simple substring match (case-insensitive)
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'date-desc':
          return new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0);
        case 'date-asc':
          return new Date(a.modifiedAt || 0) - new Date(b.modifiedAt || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [filesData, sortBy, searchQuery]);

  // Store folder display names
  useEffect(() => {
    if (files && files.length > 0) {
      const newDisplayNames = {};
      files.forEach((file) => {
        if (file.name.startsWith('user_') && file.displayName) {
          newDisplayNames[file.name] = file.displayName;
        }
      });
      if (Object.keys(newDisplayNames).length > 0) {
        setFolderDisplayNames((prev) => ({ ...prev, ...newDisplayNames }));
      }
    }
  }, [files]);

  // Get viewable files for media viewer
  const viewableFiles = useMemo(() => {
    return files.filter((f) => !f.isDirectory);
  }, [files]);

  return {
    // State
    uploading,
    currentPath,
    pathHistory,
    viewMode,
    sortBy,
    creatingFolder,
    newFolderName,
    isDragging,
    contextMenu,
    selectedContextFile,
    deletingFile,
    renamingFile,
    newFileName,
    notifications,
    processingFile,
    viewerFile,
    uploads,
    folderDisplayNames,
    files,
    isLoading,
    viewableFiles,
    searchQuery,

    // Setters
    setViewMode,
    setSortBy,
    setSearchQuery,
    setCreatingFolder,
    setNewFolderName,
    setIsDragging,
    setContextMenu,
    setSelectedContextFile,
    setDeletingFile,
    setRenamingFile,
    setNewFileName,
    setProcessingFile,
    setViewerFile,
    setUploads,
    setUploading,
    setCurrentPath,
    setPathHistory,

    // Helpers
    addNotification,
    dismissNotification,
    queryClient,
  };
}
