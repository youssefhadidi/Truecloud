/** @format */

import { useState, useEffect, useMemo, useCallback, useReducer } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';

// Action types for file operations reducer
const FILE_OPS_ACTIONS = {
  SET_DELETING: 'SET_DELETING',
  SET_RENAMING: 'SET_RENAMING',
  SET_NEW_FILENAME: 'SET_NEW_FILENAME',
  SET_PROCESSING: 'SET_PROCESSING',
  CLEAR_ALL: 'CLEAR_ALL',
};

// Initial state for file operations
const fileOpsInitialState = {
  deletingFile: null,
  renamingFile: null,
  newFileName: '',
  processingFile: null,
};

// Reducer for file operations
const fileOpsReducer = (state, action) => {
  switch (action.type) {
    case FILE_OPS_ACTIONS.SET_DELETING:
      return { ...state, deletingFile: action.payload };
    case FILE_OPS_ACTIONS.SET_RENAMING:
      return { ...state, renamingFile: action.payload, newFileName: action.payload?.name || '' };
    case FILE_OPS_ACTIONS.SET_NEW_FILENAME:
      return { ...state, newFileName: action.payload };
    case FILE_OPS_ACTIONS.SET_PROCESSING:
      return { ...state, processingFile: action.payload };
    case FILE_OPS_ACTIONS.CLEAR_ALL:
      return fileOpsInitialState;
    default:
      return state;
  }
};

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

  // Navigation state - grouped
  const [navigation, setNavigation] = useState({
    currentSubPath: initialPath,
    pathHistory: [initialPath],
    historyIndex: 0,
    isPopstateNavigation: false,
  });

  // Preferences state - grouped
  const [preferences, setPreferences] = useState({
    viewMode: typeof window !== 'undefined' ? localStorage.getItem('share-view-mode') || 'grid' : 'grid',
    sortBy: typeof window !== 'undefined' ? localStorage.getItem('share-sort') || 'name-asc' : 'name-asc',
    searchQuery: '',
  });

  // UI state - grouped
  const [ui, setUi] = useState({
    isDragging: false,
    contextMenu: null,
    selectedContextFile: null,
  });

  // Folder creation state - grouped
  const [folderCreation, setFolderCreation] = useState({
    creatingFolder: false,
    newFolderName: '',
  });

  // File operations state (uses reducer)
  const [fileOps, dispatchFileOps] = useReducer(fileOpsReducer, fileOpsInitialState);

  // Modal state - grouped
  const [modals, setModals] = useState({
    viewerFile: null,
  });

  // Upload state - grouped
  const [upload, setUpload] = useState({
    uploadingFiles: [],
  });

  // Auth state - grouped
  const [auth, setAuth] = useState({
    isLoading: true,
    requiresPassword: false,
    verifiedPassword: null,
  });

  // Selection state - grouped
  const [selection, setSelection] = useState({
    selectionMode: false,
    selectedFiles: [],
  });

  // Helper functions for grouped state updates (maintains backward compatibility)
  const setCurrentSubPath = useCallback((path) => {
    setNavigation((prev) => ({ ...prev, currentSubPath: path }));
  }, []);

  const setPathHistory = useCallback((history) => {
    setNavigation((prev) => ({ ...prev, pathHistory: history }));
  }, []);

  const setHistoryIndex = useCallback((index) => {
    setNavigation((prev) => ({ ...prev, historyIndex: index }));
  }, []);

  const setViewMode = useCallback((mode) => {
    setPreferences((prev) => ({ ...prev, viewMode: mode }));
  }, []);

  const setSortBy = useCallback((sort) => {
    setPreferences((prev) => ({ ...prev, sortBy: sort }));
  }, []);

  const setSearchQuery = useCallback((query) => {
    setPreferences((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setIsDragging = useCallback((dragging) => {
    setUi((prev) => ({ ...prev, isDragging: dragging }));
  }, []);

  const setContextMenu = useCallback((menu) => {
    setUi((prev) => ({ ...prev, contextMenu: menu }));
  }, []);

  const setSelectedContextFile = useCallback((file) => {
    setUi((prev) => ({ ...prev, selectedContextFile: file }));
  }, []);

  const setCreatingFolder = useCallback((creating) => {
    setFolderCreation((prev) => ({ ...prev, creatingFolder: creating }));
  }, []);

  const setNewFolderName = useCallback((name) => {
    setFolderCreation((prev) => ({ ...prev, newFolderName: name }));
  }, []);

  const setDeletingFile = useCallback((file) => {
    dispatchFileOps({ type: FILE_OPS_ACTIONS.SET_DELETING, payload: file });
  }, []);

  const setRenamingFile = useCallback((file) => {
    dispatchFileOps({ type: FILE_OPS_ACTIONS.SET_RENAMING, payload: file });
  }, []);

  const setNewFileName = useCallback((name) => {
    dispatchFileOps({ type: FILE_OPS_ACTIONS.SET_NEW_FILENAME, payload: name });
  }, []);

  const setProcessingFile = useCallback((fileId) => {
    dispatchFileOps({ type: FILE_OPS_ACTIONS.SET_PROCESSING, payload: fileId });
  }, []);

  const setViewerFile = useCallback((file) => {
    setModals((prev) => ({ ...prev, viewerFile: file }));
  }, []);

  const setUploadingFiles = useCallback((files) => {
    setUpload((prev) => {
      const newFiles = typeof files === 'function' ? files(prev.uploadingFiles) : files;
      return { ...prev, uploadingFiles: newFiles };
    });
  }, []);

  const setIsLoading = useCallback((loading) => {
    setAuth((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  const setRequiresPassword = useCallback((requires) => {
    setAuth((prev) => ({ ...prev, requiresPassword: requires }));
  }, []);

  const setVerifiedPassword = useCallback((password) => {
    setAuth((prev) => ({ ...prev, verifiedPassword: password }));
  }, []);

  const setSelectionMode = useCallback((mode) => {
    setSelection((prev) => ({ ...prev, selectionMode: mode }));
  }, []);

  const setSelectedFiles = useCallback((files) => {
    setSelection((prev) => {
      const newFiles = typeof files === 'function' ? files(prev.selectedFiles) : files;
      return { ...prev, selectedFiles: newFiles };
    });
  }, []);

  // Persist view mode to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('share-view-mode', preferences.viewMode);
    }
  }, [preferences.viewMode]);

  // Persist sort preference to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('share-sort', preferences.sortBy);
    }
  }, [preferences.sortBy]);

  // Sync URL with currentSubPath (but not during browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (navigation.isPopstateNavigation) {
      setNavigation((prev) => ({ ...prev, isPopstateNavigation: false }));
      return;
    }

    const url = new URL(window.location.href);
    const currentUrlPath = url.searchParams.get('path') || '';

    if (currentUrlPath !== navigation.currentSubPath) {
      if (navigation.currentSubPath) {
        url.searchParams.set('path', navigation.currentSubPath);
      } else {
        url.searchParams.delete('path');
      }
      window.history.pushState({ path: navigation.currentSubPath }, '', url.toString());
    }
  }, [navigation.currentSubPath, navigation.isPopstateNavigation]);

  // Handle browser back/forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopstate = (event) => {
      const newPath = event.state?.path ?? new URL(window.location.href).searchParams.get('path') ?? '';
      setNavigation((prev) => ({ ...prev, isPopstateNavigation: true, currentSubPath: newPath }));
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  // Reset selection on path change or when selection mode is off
  useEffect(() => {
    setSelectedFiles([]);
  }, [navigation.currentSubPath]);

  useEffect(() => {
    if (!selection.selectionMode) {
      setSelectedFiles([]);
    }
  }, [selection.selectionMode]);

  // Filter and sort files based on search query and sort criteria
  const sortedFilteredFiles = useMemo(() => {
    if (!shareData || !shareData.files) return [];

    // Filter out hidden files and apply search query
    let filtered = shareData.files.filter((f) => !f.name.startsWith('.'));

    if (preferences.searchQuery.trim()) {
      const query = preferences.searchQuery.trim();
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
        const lowerQuery = preferences.searchQuery.toLowerCase();
        filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
      }
    }

    // Sort with directories first
    const sorted = [...filtered].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      switch (preferences.sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'date-desc':
          return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        case 'date-asc':
          return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [shareData, preferences.sortBy, preferences.searchQuery]);

  // Get viewable files for media viewer (non-directories)
  const viewableFiles = useMemo(() => {
    return sortedFilteredFiles.filter((f) => !f.isDirectory);
  }, [sortedFilteredFiles]);

  return {
    // Share data
    shareData,
    token,

    // Navigation state (backward compatible)
    currentSubPath: navigation.currentSubPath,
    pathHistory: navigation.pathHistory,
    historyIndex: navigation.historyIndex,

    // Preferences state (backward compatible)
    viewMode: preferences.viewMode,
    sortBy: preferences.sortBy,
    searchQuery: preferences.searchQuery,

    // UI state (backward compatible)
    isDragging: ui.isDragging,
    contextMenu: ui.contextMenu,
    selectedContextFile: ui.selectedContextFile,

    // Folder creation state (backward compatible)
    creatingFolder: folderCreation.creatingFolder,
    newFolderName: folderCreation.newFolderName,

    // File operations state (backward compatible)
    deletingFile: fileOps.deletingFile,
    renamingFile: fileOps.renamingFile,
    newFileName: fileOps.newFileName,
    processingFile: fileOps.processingFile,

    // Modal state (backward compatible)
    viewerFile: modals.viewerFile,

    // Upload state (backward compatible)
    uploadingFiles: upload.uploadingFiles,

    // Auth state (backward compatible)
    isLoading: auth.isLoading,
    requiresPassword: auth.requiresPassword,
    verifiedPassword: auth.verifiedPassword,

    // Selection state (backward compatible)
    selectionMode: selection.selectionMode,
    selectedFiles: selection.selectedFiles,

    // File data
    sortedFilteredFiles,
    viewableFiles,

    // Navigation setters
    setCurrentSubPath,
    setPathHistory,
    setHistoryIndex,

    // Preferences setters
    setViewMode,
    setSortBy,
    setSearchQuery,

    // UI setters
    setIsDragging,
    setContextMenu,
    setSelectedContextFile,

    // Folder creation setters
    setCreatingFolder,
    setNewFolderName,

    // File operations setters
    setDeletingFile,
    setRenamingFile,
    setNewFileName,
    setProcessingFile,

    // Modal setters
    setViewerFile,

    // Upload setters
    setUploadingFiles,

    // Auth setters
    setIsLoading,
    setRequiresPassword,
    setVerifiedPassword,

    // Selection setters
    setSelectionMode,
    setSelectedFiles,

    // Helpers
    addNotification,
  };
}
