/** @format */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * useSharePage - State management for public share page
 * Mirrors useFilesPage.js structure but adapted for share-specific context
 */
export function useSharePage(token, shareData = null) {
  const { addNotification } = useNotifications();

  // Get initial path from URL (only on first mount)
  const [initialPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URL(window.location.href).searchParams.get('path') || '';
    }
    return '';
  });

  // UI State
  const [currentSubPath, setCurrentSubPath] = useState(initialPath);
  const [pathHistory, setPathHistory] = useState([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isPopstateNavigation, setIsPopstateNavigation] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('share-view-mode') || 'grid';
    }
    return 'grid';
  });
  const [sortBy, setSortBy] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('share-sort') || 'name-asc';
    }
    return 'name-asc';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedContextFile, setSelectedContextFile] = useState(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deletingFile, setDeletingFile] = useState(null);
  const [renamingFile, setRenamingFile] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [processingFile, setProcessingFile] = useState(null);
  const [viewerFile, setViewerFile] = useState(null);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [verifiedPassword, setVerifiedPassword] = useState(null);

  // Persist view mode to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('share-view-mode', viewMode);
    }
  }, [viewMode]);

  // Persist sort preference to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('share-sort', sortBy);
    }
  }, [sortBy]);

  // Sync URL with currentSubPath (but not during browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPopstateNavigation) {
      setIsPopstateNavigation(false);
      return;
    }

    const url = new URL(window.location.href);
    const currentUrlPath = url.searchParams.get('path') || '';

    if (currentUrlPath !== currentSubPath) {
      if (currentSubPath) {
        url.searchParams.set('path', currentSubPath);
      } else {
        url.searchParams.delete('path');
      }
      window.history.pushState({ path: currentSubPath }, '', url.toString());
    }
  }, [currentSubPath, isPopstateNavigation]);

  // Handle browser back/forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopstate = (event) => {
      const newPath = event.state?.path ?? new URL(window.location.href).searchParams.get('path') ?? '';
      setIsPopstateNavigation(true);
      setCurrentSubPath(newPath);
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  // Filter and sort files based on search query and sort criteria
  const sortedFilteredFiles = useMemo(() => {
    if (!shareData || !shareData.files) return [];

    // Filter out hidden files and apply search query
    let filtered = shareData.files.filter((f) => !f.name.startsWith('.'));

    if (searchQuery.trim()) {
      const query = searchQuery.trim();
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

    // Sort with directories first
    const sorted = [...filtered].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'date-desc':
          return new Date(b.mtime || 0) - new Date(a.mtime || 0);
        case 'date-asc':
          return new Date(a.mtime || 0) - new Date(b.mtime || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [shareData, sortBy, searchQuery]);

  // Get viewable files for media viewer (non-directories)
  const viewableFiles = useMemo(() => {
    return sortedFilteredFiles.filter((f) => !f.isDirectory);
  }, [sortedFilteredFiles]);

  return {
    // Share data
    shareData,
    token,
    verifiedPassword,
    requiresPassword,
    isLoading,

    // Navigation state
    currentSubPath,
    pathHistory,
    historyIndex,

    // View state
    viewMode,
    sortBy,
    searchQuery,
    isDragging,

    // Context menu state
    contextMenu,
    selectedContextFile,

    // Folder creation state
    creatingFolder,
    newFolderName,

    // File deletion state
    deletingFile,

    // File rename state
    renamingFile,
    newFileName,

    // Processing state
    processingFile,

    // Media viewer state
    viewerFile,

    // Upload state
    uploadingFiles,

    // File data
    sortedFilteredFiles,
    viewableFiles,

    // Navigation setters
    setCurrentSubPath,
    setPathHistory,
    setHistoryIndex,

    // View setters
    setViewMode,
    setSortBy,
    setSearchQuery,
    setIsDragging,

    // Context menu setters
    setContextMenu,
    setSelectedContextFile,

    // Folder creation setters
    setCreatingFolder,
    setNewFolderName,

    // File deletion setters
    setDeletingFile,

    // File rename setters
    setRenamingFile,
    setNewFileName,

    // Processing setters
    setProcessingFile,

    // Media viewer setters
    setViewerFile,

    // Upload setters
    setUploadingFiles,

    // Authentication setters
    setRequiresPassword,
    setVerifiedPassword,
    setIsLoading,

    // Helpers
    addNotification,
  };
}
