/** @format */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useFiles, usePathShares } from '@/lib/api/files';
import { useNotifications } from '@/contexts/NotificationsContext';
import {
  useTransfers,
  useTransferring,
  useFileOpsState,
  useFileOpsDispatch,
  useSelectionState,
  useSelectionDispatch,
  useModalsState,
  useModalsDispatch,
  useFolderCreationState,
  useFolderCreationDispatch,
} from '@/lib/redux/hooks';

export function useFilesPage(status) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
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
    currentPath: initialPath,
    pathHistory: [initialPath],
    historyIndex: 0,
    isPopstateNavigation: false,
  });

  // Preferences state - grouped
  const [preferences, setPreferences] = useState({
    viewMode: 'grid',
    sortBy: 'name-asc',
    searchQuery: '',
  });

  // UI state - grouped
  const [ui, setUi] = useState({
    isDragging: false,
    contextMenu: null,
    selectedContextFile: null,
  });

  // Folder creation state from Redux
  const folderCreation = useFolderCreationState();
  const { setCreatingFolder, setNewFolderName } = useFolderCreationDispatch();

  // File operations state from Redux
  const fileOps = useFileOpsState();
  const { setDeletingFile, setRenamingFile, setNewFileName, setProcessingFile } = useFileOpsDispatch();

  // Transfer state from Redux
  const reduxTransfers = useTransfers();
  const reduxTransferring = useTransferring();

  // Modal/Viewer state from Redux
  const modals = useModalsState();
  const { setViewerFile, setSharingFile, setRestoringFile } = useModalsDispatch();

  // Selection state from Redux
  const selection = useSelectionState();
  const { setSelectionMode, setSelectedFiles } = useSelectionDispatch();

  // Cache state (kept separate as it's simple)
  const [folderDisplayNames, setFolderDisplayNames] = useState({});

  // Helper functions for grouped state updates (maintains backward compatibility)
  const setCurrentPath = useCallback((path) => {
    setNavigation((prev) => ({ ...prev, currentPath: path }));
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

  // Redirect if unauthenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Persist preferences to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('fileViewMode', preferences.viewMode);
    }
  }, [preferences.viewMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('fileSortBy', preferences.sortBy);
    }
  }, [preferences.sortBy]);

  // Sync URL with currentPath (but not during browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (navigation.isPopstateNavigation) {
      setNavigation((prev) => ({ ...prev, isPopstateNavigation: false }));
      return;
    }

    const url = new URL(window.location.href);
    const currentUrlPath = url.searchParams.get('path') || '';

    if (currentUrlPath !== navigation.currentPath) {
      if (navigation.currentPath) {
        url.searchParams.set('path', navigation.currentPath);
      } else {
        url.searchParams.delete('path');
      }
      window.history.pushState({ path: navigation.currentPath }, '', url.toString());
    }
  }, [navigation.currentPath, navigation.isPopstateNavigation]);

  // Handle browser back/forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopstate = (event) => {
      const newPath = event.state?.path ?? new URL(window.location.href).searchParams.get('path') ?? '';
      setNavigation((prev) => ({ ...prev, isPopstateNavigation: true, currentPath: newPath }));
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  // Reset selection on path change
  useEffect(() => {
    setSelectedFiles([]);
  }, [navigation.currentPath]);

  // Reset selection when selection mode turns off
  useEffect(() => {
    if (!selection.selectionMode) {
      setSelectedFiles([]);
    }
  }, [selection.selectionMode]);

  // Fetch and sort files
  const { data: filesData, isLoading } = useFiles(navigation.currentPath, status === 'authenticated');

  // Fetch shared paths for share indicators
  const { data: sharedPaths } = usePathShares(navigation.currentPath);

  const files = useMemo(() => {
    // Filter out hidden files
    let filtered = (filesData || []).filter((f) => !f.name.startsWith('.'));

    // Apply search query filter
    if (preferences.searchQuery.trim()) {
      const query = preferences.searchQuery.trim();

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
        const lowerQuery = preferences.searchQuery.toLowerCase();
        filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      switch (preferences.sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'date-desc':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'date-asc':
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [filesData, preferences.sortBy, preferences.searchQuery]);

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
    // Navigation state (backward compatible)
    currentPath: navigation.currentPath,
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
    sharingFile: modals.sharingFile,
    restoringFile: modals.restoringFile,

    // Selection state (backward compatible)
    selectionMode: selection.selectionMode,
    selectedFiles: selection.selectedFiles,

    // Transfer state from Redux (uploads/downloads)
    uploading: reduxTransferring,
    uploads: reduxTransfers.filter((t) => t.type === 'upload'),
    transfers: reduxTransfers,

    // Other state
    folderDisplayNames,
    files,
    isLoading,
    viewableFiles,
    sharedPaths,

    // Setters (backward compatible)
    setCurrentPath,
    setPathHistory,
    setHistoryIndex,
    setViewMode,
    setSortBy,
    setSearchQuery,
    setIsDragging,
    setContextMenu,
    setSelectedContextFile,
    setCreatingFolder,
    setNewFolderName,
    setDeletingFile,
    setRenamingFile,
    setNewFileName,
    setProcessingFile,
    setViewerFile,
    setSharingFile,
    setRestoringFile,
    setSelectionMode,
    setSelectedFiles,

    // Helpers
    addNotification,
    queryClient,
  };
}
