/** @format */

import { useState, useEffect, useMemo, useCallback } from 'react';

// Cached collator with natural numeric ordering ("file2" before "file10").
// Roughly 5–10× faster than calling String.prototype.localeCompare per pair
// on large folders, since the collator is built once instead of per call.
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function toTimestamp(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  return Date.parse(v) || 0;
}

function compareFiles(a, b, sortBy, ts) {
  if (a.isDirectory && !b.isDirectory) return -1;
  if (!a.isDirectory && b.isDirectory) return 1;
  switch (sortBy) {
    case 'name-asc':  return NAME_COLLATOR.compare(a.name, b.name);
    case 'name-desc': return NAME_COLLATOR.compare(b.name, a.name);
    case 'date-desc': return (ts.get(b) || 0) - (ts.get(a) || 0);
    case 'date-asc':  return (ts.get(a) || 0) - (ts.get(b) || 0);
    case 'size-desc': return (b.size || 0) - (a.size || 0);
    case 'size-asc':  return (a.size || 0) - (b.size || 0);
    default: return 0;
  }
}

// Decorate-sort: when sorting by date, precompute timestamps once per file so
// comparator calls (~n log n of them) don't re-parse the ISO string each time.
function sortFiles(items, sortBy) {
  if (sortBy === 'date-asc' || sortBy === 'date-desc') {
    const ts = new Map();
    for (const f of items) ts.set(f, toTimestamp(f.updatedAt));
    return items.sort((a, b) => compareFiles(a, b, sortBy, ts));
  }
  return items.sort((a, b) => compareFiles(a, b, sortBy));
}

import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useFiles, usePathShares } from '@/lib/api/files';
import { useUsbFiles } from '@/hooks/useUsbFiles';
import { isUsbPath } from '@/lib/usbPath';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useActiveDownloads } from '@/hooks/useActiveDownloads';
import { useFileChanges } from '@/hooks/useFileChanges';
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
  const pathname = usePathname();
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

  // Preferences state - grouped (hydrated from localStorage on mount)
  const [preferences, setPreferences] = useState(() => {
    if (typeof window === 'undefined') {
      return { viewMode: 'grid', sortBy: 'name-asc', searchQuery: '' };
    }
    return {
      viewMode: localStorage.getItem('fileViewMode') || 'grid',
      sortBy: localStorage.getItem('fileSortBy') || 'name-asc',
      searchQuery: '',
    };
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

  // Sync URL with currentPath via direct history.replaceState — never go
  // through router.replace, which could start a transition that interferes
  // with an outgoing router.push() to a different route.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname !== '/files/list') return;
    if (navigation.isPopstateNavigation) {
      setNavigation((prev) => ({ ...prev, isPopstateNavigation: false }));
      return;
    }
    const currentUrlPath = new URL(window.location.href).searchParams.get('path') || '';
    if (currentUrlPath !== navigation.currentPath) {
      const target = navigation.currentPath
        ? `/files/list?path=${encodeURIComponent(navigation.currentPath)}`
        : '/files/list';
      window.history.replaceState({ path: navigation.currentPath }, '', target);
      window.dispatchEvent(
        new CustomEvent('tc-files-set-path', { detail: { path: navigation.currentPath } }),
      );
    }
  }, [navigation.currentPath, navigation.isPopstateNavigation, pathname]);

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

  // External in-page navigation (e.g. sidebar favorite click while on /files)
  // dispatches a `tc-files-set-path` event instead of calling router.push,
  // so we never start a router transition that has to abort itself.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event) => {
      const newPath = event.detail?.path ?? '';
      setNavigation((prev) => {
        if (prev.currentPath === newPath) return prev;
        return { ...prev, isPopstateNavigation: true, currentPath: newPath };
      });
    };
    window.addEventListener('tc-files-set-path', handler);
    return () => window.removeEventListener('tc-files-set-path', handler);
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

  // USB mode: virtual path that targets a mounted USB drive
  const usbMode = isUsbPath(navigation.currentPath);

  // Fetch files and initial downloads from API (skipped in USB mode)
  const { files: filesData, downloads: apiDownloads, isLoading: isLoadingFiles, error: filesError } = useFiles(
    navigation.currentPath,
    status === 'authenticated' && !usbMode,
  );

  // Fetch USB drive contents when in USB mode
  const { files: usbFilesData, isLoading: isLoadingUsb } = useUsbFiles(
    navigation.currentPath,
    status === 'authenticated' && usbMode,
  );

  const isLoading = usbMode ? isLoadingUsb : isLoadingFiles;

  // Get real-time download progress via WebSocket (has priority over API downloads)
  // Pass apiDownloads to initialize state without making a separate API call
  const { downloads: wsDownloads, pauseDownload, resumeDownload, removeDownload } = useActiveDownloads(apiDownloads);

  // Listen for file changes via WebSocket and invalidate cache
  useFileChanges();

  // Fetch shared paths for share indicators
  const { data: sharedPaths } = usePathShares();

  // Listen for torrent download completion to refresh file list
  useEffect(() => {
    const handleTorrentComplete = (event) => {
      const { path: completedPath } = event.detail || {};
      // If download completed in current path, refresh file list
      if (completedPath === navigation.currentPath) {
        console.log('[FILES PAGE] Torrent download completed in current path, refreshing...');
        queryClient.invalidateQueries({ queryKey: ['files', navigation.currentPath] });
      }
    };

    window.addEventListener('torrent-download-complete', handleTorrentComplete);
    return () => window.removeEventListener('torrent-download-complete', handleTorrentComplete);
  }, [navigation.currentPath, queryClient]);

  // Sorted+filtered file list — independent of wsDownloads so websocket ticks
  // during an active download don't force a full re-sort of the entire folder.
  const sortedFiltered = useMemo(() => {
    if (usbMode) {
      const list = usbFilesData || [];
      const sorted = sortFiles([...list], preferences.sortBy);
      if (preferences.searchQuery.trim()) {
        const q = preferences.searchQuery.trim().toLowerCase();
        return sorted.filter((f) => f.name.toLowerCase().includes(q));
      }
      return sorted;
    }

    let filtered = (filesData || []).filter((f) => !f.name.startsWith('.'));

    if (preferences.searchQuery.trim()) {
      const query = preferences.searchQuery.trim();
      const isGlobPattern = query.includes('*') || query.includes('?');

      if (isGlobPattern) {
        const regexPattern = query
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');

        try {
          const regex = new RegExp(regexPattern, 'i');
          filtered = filtered.filter((file) => regex.test(file.name));
        } catch (e) {
          const lowerQuery = query.toLowerCase();
          filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
        }
      } else {
        const lowerQuery = preferences.searchQuery.toLowerCase();
        filtered = filtered.filter((file) => file.name.toLowerCase().includes(lowerQuery));
      }
    }

    return sortFiles(filtered, preferences.sortBy);
  }, [filesData, preferences.sortBy, preferences.searchQuery, usbMode, usbFilesData]);

  const files = useMemo(() => {
    if (usbMode) return sortedFiltered;

    // Merge API + WebSocket downloads for current path. WebSocket wins on the
    // overlap so live progress always reflects the most recent tick.
    const mergedDownloads = new Map();
    if (Array.isArray(apiDownloads)) {
      for (const d of apiDownloads) {
        if (d.path === navigation.currentPath) mergedDownloads.set(d.gid, d);
      }
    }
    for (const [gid, wsDownload] of Object.entries(wsDownloads || {})) {
      if (wsDownload.path === navigation.currentPath) {
        mergedDownloads.set(gid, { ...mergedDownloads.get(gid), ...wsDownload });
      }
    }

    // A finished download stays in the downloads page's history, but here its
    // placeholder row would sit next to the real file it just produced. Drop it
    // and let the folder listing speak for itself.
    for (const [gid, d] of mergedDownloads) {
      if (d.status === 'complete') mergedDownloads.delete(gid);
    }

    // Common case: no downloads in this folder — just return the cached sort.
    if (mergedDownloads.size === 0) return sortedFiltered;

    const downloadEntries = Array.from(mergedDownloads.values()).map((d) => ({
      id: `dl-${d.gid}`,
      name: d.name,
      displayName: d.name,
      isDirectory: false,
      isDownloading: true,
      downloadGid: d.gid,
      downloadProgress: d.progress || 0,
      downloadSpeed: d.downloadSpeed || '0 B/s',
      downloadStatus: d.status || 'active',
      size: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return sortFiles(downloadEntries.concat(sortedFiltered), preferences.sortBy);
  }, [sortedFiltered, apiDownloads, wsDownloads, navigation.currentPath, usbMode, preferences.sortBy]);

  // Store folder display names — derive a stable signature so the effect only
  // fires when the user_* displayName mappings actually change in content, not
  // just when the `files` array reference changes (which happens on every
  // websocket tick during downloads). Signature is a plain concat string —
  // cheaper than JSON.stringify and skips the parse round-trip.
  const { userFolderEntries, userFoldersSignature } = useMemo(() => {
    if (!files || files.length === 0) return { userFolderEntries: null, userFoldersSignature: '' };
    const entries = {};
    const keys = [];
    for (const f of files) {
      if (f.name.startsWith('user_') && f.displayName) {
        entries[f.name] = f.displayName;
        keys.push(f.name);
      }
    }
    if (keys.length === 0) return { userFolderEntries: null, userFoldersSignature: '' };
    keys.sort();
    let sig = '';
    for (const k of keys) sig += `${k}\x00${entries[k]}\x01`;
    return { userFolderEntries: entries, userFoldersSignature: sig };
  }, [files]);

  useEffect(() => {
    if (!userFolderEntries) return;
    setFolderDisplayNames((prev) => {
      for (const key in userFolderEntries) {
        if (prev[key] !== userFolderEntries[key]) {
          return { ...prev, ...userFolderEntries };
        }
      }
      return prev;
    });
    // Effect intentionally depends on the stable signature, not the entries
    // object, so it only re-runs when content actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFoldersSignature]);

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
    filesError,
    viewableFiles,
    sharedPaths,
    usbMode,

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

    // Download handlers (real-time via WebSocket)
    pauseDownload,
    resumeDownload,
    removeDownload,

    // Helpers
    addNotification,
    queryClient,
  };
}
