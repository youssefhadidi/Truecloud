/** @format */

'use client';

import { useStableSession } from '@/lib/api/session';
import { useRouter } from 'next/navigation';
import { Suspense, lazy, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  FiUpload, FiFolder, FiPlus, FiHome, FiChevronRight, FiGrid, FiList,
  FiArrowLeft, FiArrowRight, FiRefreshCw, FiSearch, FiCheckSquare, FiSquare, FiImage,
  FiDownload, FiTrash2, FiX,
} from 'react-icons/fi';
import { TbMagnet } from 'react-icons/tb';
import UploadStatus from '@/components/files/UploadStatus';
import ContextMenu from '@/components/files/ContextMenu';
import { useSearch } from '@/lib/api/search';
import { useFilesContext } from '../FilesContext';
import { useFilesPage } from '@/hooks/useFilesPage';
import { useFileHandlers } from '@/hooks/useFileHandlers';
import { useDebounce } from '@/hooks/useDebounce';
import { useNavigation, useMediaViewer, useDragAndDrop, useContextMenu, useFileUtils } from '@/hooks/useFileOperations';
import { useShareOrDownload } from '@/hooks/useShareOrDownload';
import { useFavorites, useToggleFavorite } from '@/lib/api/favorites';
import { useMoveFiles, useDeleteFile, fetchFoldersHelper } from '@/lib/api/files';
import { getFileExtension } from '@/lib/clientFileUtils';
import { parseUsbPath, USB_PREFIX } from '@/lib/usbPath';
import Btn from '@/components/ui/Btn';
import IconBtn from '@/components/ui/IconBtn';
import Divider from '@/components/ui/Divider';
import Spinner from '@/components/ui/Spinner';
import FolderPinModal from '@/components/FolderPinModal';
import { setFolderPin, clearAllFolderPins, useFolderPins, appendFolderPinToUrl } from '@/lib/folderPinStore';
import { useTranslation } from '@/components/LanguageProvider';

const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const GridView = lazy(() => import('@/components/files/GridView'));
const ListView = lazy(() => import('@/components/files/ListView'));
const ShareModal = lazy(() => import('@/components/files/ShareModal'));
const MoveModal = lazy(() => import('@/components/files/MoveModal'));
const MagnetModal = lazy(() => import('@/components/files/MagnetModal'));

function LoadingPanel({ label = 'Loading…' }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-3)' }}>
      <Spinner size={28} color="var(--accent)" borderColor="var(--border)" thickness={3} />
      <p style={{ fontSize: 13 }}>{label}</p>
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-3)' }}>
      <FiFolder size={36} />
      <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
    </div>
  );
}

function FilesPageContent() {
  const { status } = useStableSession();
  const router = useRouter();
  const { t } = useTranslation();
  const state = useFilesPage(status);

  const { searchQuery: globalSearchQuery, setSearchQuery: setGlobalSearchQuery } = useFilesContext();
  const debouncedSearchQuery = useDebounce(globalSearchQuery, 300);
  const { data: globalSearchResults = [] } = useSearch(debouncedSearchQuery);
  const isGlobalSearch = globalSearchQuery.length >= 2 && globalSearchResults.length > 0;

  const searchFiles = useMemo(() => {
    if (!isGlobalSearch) return [];
    return globalSearchResults.map((r) => ({
      id: r.name,
      name: r.name,
      displayName: r.name,
      isDirectory: r.isDirectory,
      size: Number(r.size) || 0,
      extension: r.extension,
      createdAt: new Date(),
      updatedAt: new Date(),
      _parentPath: r.parentPath || '',
      _fullPath: r.path,
    }));
  }, [isGlobalSearch, globalSearchResults]);

  const displayFiles = isGlobalSearch ? searchFiles : state.files;

  const uploadInputRef = useRef(null);
  const gridViewRef = useRef(null);
  const listViewRef = useRef(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState(null);

  useEffect(() => {
    if (pendingScrollTarget && !state.isLoading && state.files.length > 0) {
      const ref = state.viewMode === 'list' ? listViewRef : gridViewRef;
      const timer = setTimeout(() => {
        ref.current?.scrollToFile(pendingScrollTarget);
        setPendingScrollTarget(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pendingScrollTarget, state.isLoading, state.files, state.viewMode]);

  const navigation = useNavigation({
    currentPath: state.currentPath,
    pathHistory: state.pathHistory,
    historyIndex: state.historyIndex,
    setCurrentPath: state.setCurrentPath,
    setPathHistory: state.setPathHistory,
    setHistoryIndex: state.setHistoryIndex,
  });

  const mediaViewer = useMediaViewer({
    viewerFile: state.viewerFile,
    viewableFiles: state.viewableFiles,
    setViewerFile: state.setViewerFile,
  });

  const dragDrop = useDragAndDrop({ setIsDragging: state.setIsDragging });

  const contextMenu = useContextMenu({
    setContextMenu: state.setContextMenu,
    setSelectedContextFile: state.setSelectedContextFile,
  });

  const fileUtils = useFileUtils({
    currentPath: state.currentPath,
    folderDisplayNames: state.folderDisplayNames,
  });

  const { handleShareOrDownload } = useShareOrDownload();

  const { data: favorites = [] } = useFavorites();
  const { toggleFavorite } = useToggleFavorite();
  const favoritePaths = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites]);
  const moveMutation = useMoveFiles();
  const bulkDeleteMutation = useDeleteFile(state.currentPath);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [magnetModalOpen, setMagnetModalOpen] = useState(false);
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [convertingHeic, setConvertingHeic] = useState(false);
  // Folder-lock unlock state. The PIN itself lives in the module-level
  // folderPinStore (lib/folderPinStore.js) keyed by lock path, so the axios
  // interceptor and download-URL helpers can all reach it. We only keep the
  // pending-modal state here. PINs persist for the lifetime of this page
  // (cleared on unmount) so multiple locked folders can be open at once.
  const [pendingLock, setPendingLock] = useState(null); // { name, path }

  const handlers = useFileHandlers({
    currentPath: state.currentPath,
    setCreatingFolder: state.setCreatingFolder,
    setNewFolderName: state.setNewFolderName,
    newFolderName: state.newFolderName,
    addNotification: state.addNotification,
    setDeletingFile: state.setDeletingFile,
    setProcessingFile: state.setProcessingFile,
    setRenamingFile: state.setRenamingFile,
    setNewFileName: state.setNewFileName,
    setSharingFile: state.setSharingFile,
    setRestoringFile: state.setRestoringFile,
    pauseDownload: state.pauseDownload,
    resumeDownload: state.resumeDownload,
    removeDownload: state.removeDownload,
  });

  useEffect(() => {
    if (!state.selectionMode) setBulkDeleteConfirming(false);
  }, [state.selectionMode]);

  const handleBulkDownload = useCallback(async () => {
    const filesToDownload = state.files.filter((f) => state.selectedFiles.includes(f.name));
    for (let i = 0; i < filesToDownload.length; i++) {
      const f = filesToDownload[i];
      await fileUtils.handleDownload(f.id, f.name);
      if (i < filesToDownload.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    state.setSelectionMode(false);
    state.setSelectedFiles([]);
  }, [state, fileUtils]);

  const handleBulkDelete = useCallback(async () => {
    if (bulkDeleting) return;
    setBulkDeleting(true);
    setBulkDeleteConfirming(false);
    let succeeded = 0;
    let failed = 0;
    for (const name of state.selectedFiles) {
      try {
        await bulkDeleteMutation.mutateAsync(name);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setBulkDeleting(false);
    state.setSelectionMode(false);
    state.setSelectedFiles([]);
    if (failed === 0) state.addNotification('success', t('notify.deletedItems', { count: succeeded }));
    else state.addNotification('warning', t('notify.deletedSomeFailed', { succeeded, failed }));
  }, [bulkDeleting, bulkDeleteMutation, state, t]);

  const selectedFileSet = useMemo(() => new Set(state.selectedFiles), [state.selectedFiles]);

  const heicFiles = useMemo(() => {
    return state.files
      .filter((f) => {
        if (f.isDirectory) return false;
        const ext = getFileExtension(f.name);
        return ext === 'heic' || ext === 'heif';
      })
      .map((f) => f.name);
  }, [state.files]);

  const hasHeicFiles = heicFiles.length > 0;

  const selectedAreAllHeic = useMemo(() => {
    if (!state.selectionMode || state.selectedFiles.length === 0) return false;
    return state.selectedFiles.every((n) => {
      const ext = getFileExtension(n);
      return ext === 'heic' || ext === 'heif';
    });
  }, [state.selectionMode, state.selectedFiles]);

  const [downloadingHeicAsJpeg, setDownloadingHeicAsJpeg] = useState(false);

  const handleDownloadSelectedAsJpeg = useCallback(async () => {
    if (state.selectedFiles.length === 0) return;
    setDownloadingHeicAsJpeg(true);
    const failed = [];
    for (let i = 0; i < state.selectedFiles.length; i++) {
      const fileName = state.selectedFiles[i];
      try {
        const params = new URLSearchParams({
          path: state.currentPath,
          format: 'jpeg',
          quality: '100',
          w: '0',
          h: '0',
        });
        const targetPath = state.currentPath ? `${state.currentPath}/${fileName}` : fileName;
        const url = appendFolderPinToUrl(
          `/api/files/optimize-image/${encodeURIComponent(fileName)}?${params}`,
          targetPath,
        );
        const outName = fileName.replace(/\.(heic|heif)$/i, '.jpeg');
        await handleShareOrDownload(url, outName);
        if (i < state.selectedFiles.length - 1) await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error('JPEG download failed:', fileName, err);
        failed.push(fileName);
      }
    }
    setDownloadingHeicAsJpeg(false);
    state.setSelectionMode(false);
    state.setSelectedFiles([]);
    if (failed.length === 0) {
      state.addNotification('success', t('notify.downloadedAsJpeg', { count: state.selectedFiles.length }));
    } else {
      state.addNotification('warning', t('notify.failedFiles', { count: failed.length, names: failed.join(', ') }));
    }
  }, [state, handleShareOrDownload, t]);

  const selectableFiles = useMemo(
    () => state.files.filter((f) => !f.isDownloading),
    [state.files],
  );
  const allSelected =
    selectableFiles.length > 0 && state.selectedFiles.length >= selectableFiles.length;

  const lastSelectedRef = useRef(null);

  useEffect(() => {
    if (!state.selectionMode) lastSelectedRef.current = null;
  }, [state.selectionMode]);

  // Keyboard shortcuts. Skip when typing or when a modal/inline-editor owns the
  // keystroke. Media viewer has its own handler — defer to it when open.
  useEffect(() => {
    const isTyping = (t) => {
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const modalOpen = () =>
      Boolean(
        state.sharingFile ||
          state.creatingFolder ||
          state.renamingFile ||
          state.deletingFile ||
          moveModalOpen ||
          pendingLock,
      );

    const readOnly = Boolean(state.usbMode);

    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (isTyping(e.target)) return;

      // Escape: exit selection mode. Defer to modals / media viewer.
      if (e.key === 'Escape') {
        if (state.viewerFile || modalOpen()) return;
        if (state.selectionMode) {
          e.preventDefault();
          state.setSelectionMode(false);
          state.setSelectedFiles([]);
        }
        return;
      }

      if (state.viewerFile) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const { altKey: alt, shiftKey: shift } = e;

      // Alt+←/→ — navigate history (overrides browser back/forward)
      if (alt && !ctrl && !shift && e.key === 'ArrowLeft') {
        if (navigation.canGoBack) {
          e.preventDefault();
          navigation.goBack();
        }
        return;
      }
      if (alt && !ctrl && !shift && e.key === 'ArrowRight') {
        if (navigation.canGoForward) {
          e.preventDefault();
          navigation.goForward();
        }
        return;
      }

      // Ctrl/Cmd+A — select all in current folder
      if (ctrl && !alt && !shift && (e.key === 'a' || e.key === 'A')) {
        if (isGlobalSearch || readOnly || modalOpen()) return;
        if (selectableFiles.length === 0) return;
        e.preventDefault();
        if (!state.selectionMode) state.setSelectionMode(true);
        if (allSelected) state.setSelectedFiles([]);
        else state.setSelectedFiles(selectableFiles.map((f) => f.name));
        return;
      }

      if (modalOpen()) return;

      // Delete — two-step bulk delete (first press shows confirm, second deletes)
      if (!ctrl && !alt && !shift && e.key === 'Delete') {
        if (readOnly || isGlobalSearch) return;
        if (!state.selectionMode || state.selectedFiles.length === 0 || bulkDeleting) return;
        e.preventDefault();
        if (bulkDeleteConfirming) handleBulkDelete();
        else setBulkDeleteConfirming(true);
        return;
      }

      // F2 — rename the single selected file
      if (!ctrl && !alt && !shift && e.key === 'F2') {
        if (readOnly || isGlobalSearch) return;
        if (state.selectedFiles.length !== 1) return;
        const file = state.files.find((f) => f.name === state.selectedFiles[0]);
        if (!file) return;
        e.preventDefault();
        handlers.initiateRename(file);
        return;
      }

      // Single-letter shortcuts (no modifier)
      if (ctrl || alt || shift) return;

      switch (e.key) {
        case 'n':
        case 'N':
          if (readOnly || isGlobalSearch || state.creatingFolder) return;
          e.preventDefault();
          handlers.initiateCreateFolder();
          return;
        case 'm':
        case 'M':
          if (readOnly || isGlobalSearch) return;
          if (!state.selectionMode || state.selectedFiles.length === 0) return;
          e.preventDefault();
          setMoveModalOpen(true);
          return;
        case 'g':
        case 'G':
          e.preventDefault();
          state.setViewMode('grid');
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          state.setViewMode('list');
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    state,
    navigation,
    handlers,
    isGlobalSearch,
    selectableFiles,
    allSelected,
    moveModalOpen,
    pendingLock,
    bulkDeleteConfirming,
    bulkDeleting,
    handleBulkDelete,
  ]);

  const toggleSelection = useCallback(
    (file, mods = {}) => {
      const { ctrl = false, shift = false } = mods;
      const names = state.selectedFiles;

      if (shift && lastSelectedRef.current && lastSelectedRef.current !== file.name) {
        const fromIdx = selectableFiles.findIndex((f) => f.name === lastSelectedRef.current);
        const toIdx = selectableFiles.findIndex((f) => f.name === file.name);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const rangeNames = selectableFiles.slice(a, b + 1).map((f) => f.name);
          const merged = Array.from(new Set([...names, ...rangeNames]));
          state.setSelectedFiles(merged);
          lastSelectedRef.current = file.name;
          if (merged.length > 0 && !state.selectionMode) state.setSelectionMode(true);
          return;
        }
      }

      const next = names.includes(file.name)
        ? names.filter((n) => n !== file.name)
        : [...names, file.name];
      state.setSelectedFiles(next);
      lastSelectedRef.current = next.includes(file.name) ? file.name : null;

      if (next.length > 0 && !state.selectionMode) state.setSelectionMode(true);
      else if (next.length === 0 && state.selectionMode && ctrl) state.setSelectionMode(false);
    },
    [state.selectedFiles, state.setSelectedFiles, state.selectionMode, state.setSelectionMode, selectableFiles],
  );

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      state.setSelectedFiles([]);
    } else {
      state.setSelectedFiles(selectableFiles.map((f) => f.name));
    }
  }, [allSelected, selectableFiles, state.setSelectedFiles]);

  const queryClient = useQueryClient();

  const unlockedPins = useFolderPins();

  const normalizePath = useCallback(
    (p) => (p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    [],
  );

  // Clear all folder PINs on unmount so they don't leak across pages/sessions.
  useEffect(() => {
    return () => {
      clearAllFolderPins();
    };
  }, []);

  // Deep-link case: user landed/refreshed inside a locked folder. The listing
  // query returns 423 + { error: 'pin_required', path }. The `path` field is
  // the actual locked ancestor — use it directly so unlocking grants the full
  // subtree (not just the deep-linked leaf).
  useEffect(() => {
    if (pendingLock) return;
    const err = state.filesError;
    if (err?.response?.status !== 423) return;
    if (err?.response?.data?.error !== 'pin_required') return;
    const lockPath = err.response.data.path;
    if (!lockPath) return;
    if (unlockedPins.has(lockPath)) return; // already unlocked, must be stale
    const name = lockPath.split('/').pop();
    setPendingLock({ name, path: lockPath });
  }, [state.filesError, pendingLock, unlockedPins]);

  const handleFolderClick = useCallback(
    (name, file) => {
      // file?.locked is true when the folder being clicked has its own lock
      // entry. The full lock path is currentPath + name.
      if (file?.locked) {
        const lockPath = state.currentPath ? `${state.currentPath}/${name}` : name;
        const normalized = normalizePath(lockPath);
        // Already-unlocked: navigate without re-prompting.
        if (unlockedPins.has(normalized)) {
          navigation.navigateToFolder(name);
          return;
        }
        setPendingLock({ name, path: normalized });
        return;
      }
      navigation.navigateToFolder(name);
    },
    [navigation, state.currentPath, normalizePath, unlockedPins],
  );

  const handlePinSuccess = useCallback(
    (pin) => {
      if (!pendingLock) return;
      setFolderPin(pendingLock.path, pin);
      // Only navigate when we're not already inside the unlocked subtree —
      // the deep-link case lands here with currentPath already at e.g.
      // "Documents/Reports" while the lock is on "Documents".
      const cp = normalizePath(state.currentPath);
      const lp = pendingLock.path;
      const isInside = cp === lp || cp.startsWith(lp + '/');
      if (!isInside) {
        navigation.navigateToFolder(pendingLock.name);
      }
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setPendingLock(null);
    },
    [pendingLock, navigation, queryClient, state.currentPath, normalizePath],
  );

  const fetchMoveFolders = useCallback(
    async (path) => {
      return queryClient.fetchQuery({
        queryKey: ['folders', path],
        queryFn: () => fetchFoldersHelper(path),
      });
    },
    [queryClient],
  );

  const handleConfirmMove = async (destinationPath) => {
    if (destinationPath === state.currentPath) {
      state.addNotification('error', t('notify.selectDifferentDestination'));
      return;
    }
    try {
      await moveMutation.mutateAsync({
        items: state.selectedFiles,
        sourcePath: state.currentPath,
        destinationPath,
      });
      state.addNotification('success', t('notify.movedItems', { count: state.selectedFiles.length }));
      state.setSelectionMode(false);
      setMoveModalOpen(false);
    } catch (error) {
      const message = error?.response?.data?.error || error.message || t('notify.failedMoveItems');
      state.addNotification('error', message, t('notify.titles.moveError'));
    }
  };

  const handleConvertHeicToJpeg = async () => {
    if (heicFiles.length === 0) return;
    setConvertingHeic(true);
    try {
      const params = new URLSearchParams({
        path: state.currentPath,
      });
      const zipUrl = appendFolderPinToUrl(
        `/api/files/heic-to-jpeg-zip?${params}`,
        state.currentPath || '',
      );
      const folderName = (state.currentPath || '').split('/').filter(Boolean).pop() || 'heic-to-jpeg';
      await handleShareOrDownload(zipUrl, `${folderName}-jpeg.zip`);
      state.addNotification('success', t('notify.preparingHeicZip', { count: heicFiles.length }));
    } catch (error) {
      console.error('HEIC to JPEG zip failed:', error);
      state.addNotification('error', t('notify.heicConversionFailed'));
    } finally {
      setTimeout(() => setConvertingHeic(false), 1500);
    }
  };

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <LoadingPanel label={t('common.loading')} />
      </div>
    );
  }

  const usbMode = state.usbMode;
  const usbParsed = usbMode ? parseUsbPath(state.currentPath) : null;
  const readOnly = usbMode;

  const breadcrumbItems = isGlobalSearch
    ? null
    : usbMode
    ? (usbParsed?.subPath || '').split('/').filter(Boolean)
    : (state.currentPath || '').split('/').filter(Boolean);

  return (
    <div
      style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg)', minHeight: 0 }}
      onClick={contextMenu.closeContextMenu}
    >
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          position: 'relative',
        }}
        onDragEnter={isGlobalSearch || readOnly ? undefined : dragDrop.handleDragEnter}
        onDragOver={isGlobalSearch || readOnly ? undefined : dragDrop.handleDragOver}
        onDragLeave={isGlobalSearch || readOnly ? undefined : dragDrop.handleDragLeave}
        onDrop={isGlobalSearch || readOnly ? undefined : (e) => dragDrop.handleDropEvent(e, handlers.handleDrop)}
      >
        {/* Drag overlay */}
        {!isGlobalSearch && state.isDragging && (
          <div className="tc-drag-overlay">
            <div style={{ textAlign: 'center', color: 'var(--accent)' }}>
              <FiUpload size={40} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 18, fontWeight: 700 }}>{t('files.dropToUpload')}</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                {t('files.filesUploadedToCurrent')}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div
          style={{
            minHeight: 52,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {!isGlobalSearch && !readOnly && (
            <>
              <Btn variant="primary" size="sm" disabled={state.uploading} onClick={() => uploadInputRef.current?.click()}>
                <FiUpload size={13} />
                {state.uploading ? t('files.uploading') : t('common.upload')}
              </Btn>
              <input
                ref={uploadInputRef}
                type="file"
                style={{ display: 'none' }}
                multiple
                onChange={handlers.handleUpload}
                disabled={state.uploading}
              />
              <Btn
                variant="surface"
                size="sm"
                onClick={handlers.initiateCreateFolder}
                disabled={state.creatingFolder}
              >
                <FiPlus size={13} />
                {t('files.newFolder')}
              </Btn>
              <IconBtn
                icon={TbMagnet}
                title={t('files.addMagnet')}
                onClick={() => setMagnetModalOpen(true)}
              />
              <Btn
                variant={state.selectionMode ? 'primary' : 'surface'}
                size="sm"
                onClick={() => state.setSelectionMode(!state.selectionMode)}
              >
                <FiCheckSquare size={13} />
                {state.selectionMode ? t('files.selecting') : t('common.select')}
              </Btn>

              {state.selectionMode && (
                <>
                  <Divider vertical />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
                    {t('files.nSelected', { count: state.selectedFiles.length })}
                  </span>
                  <Btn
                    variant="surface"
                    size="sm"
                    onClick={handleToggleSelectAll}
                    disabled={selectableFiles.length === 0 || bulkDeleting}
                  >
                    {allSelected ? <FiSquare size={13} /> : <FiCheckSquare size={13} />}
                    {allSelected ? t('files.deselectAll') : t('files.selectAll')}
                  </Btn>
                  <IconBtn
                    icon={FiDownload}
                    title={t('files.downloadSelected')}
                    disabled={state.selectedFiles.length === 0 || bulkDeleting}
                    onClick={handleBulkDownload}
                  />
                  {selectedAreAllHeic && (
                    <Btn
                      variant="surface"
                      size="sm"
                      onClick={handleDownloadSelectedAsJpeg}
                      disabled={downloadingHeicAsJpeg || bulkDeleting}
                    >
                      <FiImage size={13} />
                      {downloadingHeicAsJpeg
                        ? t('files.downloading')
                        : t('files.downloadAsJpegN', { count: state.selectedFiles.length })}
                    </Btn>
                  )}
                  <IconBtn
                    icon={FiFolder}
                    title={t('files.moveSelected')}
                    disabled={state.selectedFiles.length === 0 || moveMutation.isPending}
                    onClick={() => setMoveModalOpen(true)}
                  />
                  {bulkDeleteConfirming ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                        {t('files.deleteN', { count: state.selectedFiles.length })}
                      </span>
                      <Btn variant="danger" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                        {bulkDeleting ? t('files.deleting') : t('common.confirm')}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setBulkDeleteConfirming(false)} disabled={bulkDeleting}>
                        {t('common.cancel')}
                      </Btn>
                    </>
                  ) : (
                    <IconBtn
                      icon={FiTrash2}
                      title={t('files.deleteSelected')}
                      danger
                      disabled={state.selectedFiles.length === 0 || bulkDeleting}
                      onClick={() => setBulkDeleteConfirming(true)}
                    />
                  )}
                </>
              )}

              {hasHeicFiles && (
                <Btn variant="surface" size="sm" onClick={handleConvertHeicToJpeg} disabled={convertingHeic}>
                  <FiImage size={13} />
                  {convertingHeic
                    ? t('files.preparingZip')
                    : t('files.heicToJpegZipN', { count: heicFiles.length })}
                </Btn>
              )}
            </>
          )}

          {isGlobalSearch && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
              <FiSearch size={14} />
              {t('files.searchResultsN', { count: searchFiles.length })}
            </span>
          )}

          {readOnly && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
              {t('files.usbReadOnly')}
            </span>
          )}

          {/* Filter input */}
          <div
            style={{
              display: 'none',
              alignItems: 'center',
              gap: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              padding: '4px 10px',
              minWidth: 200,
            }}
            data-show-filter
          >
            <FiSearch size={13} color="var(--text-3)" />
            <input
              type="text"
              value={state.searchQuery}
              onChange={(e) => state.setSearchQuery(e.target.value)}
              placeholder={t('files.filter')}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 12,
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
                flex: 1,
              }}
            />
            {state.searchQuery && (
              <button
                onClick={() => state.setSearchQuery('')}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 0 }}
              >
                <FiX size={12} />
              </button>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <select
            value={state.sortBy}
            onChange={(e) => state.setSortBy(e.target.value)}
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="name-asc">{t('files.sortNameAsc')}</option>
            <option value="name-desc">{t('files.sortNameDesc')}</option>
            <option value="date-desc">{t('files.sortDateNew')}</option>
            <option value="date-asc">{t('files.sortDateOld')}</option>
            <option value="size-desc">{t('files.sortSizeBig')}</option>
            <option value="size-asc">{t('files.sortSizeSmall')}</option>
          </select>

          <Divider vertical />

          <div
            style={{
              display: 'flex',
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-sm)',
              padding: 2,
              gap: 2,
            }}
          >
            <IconBtn icon={FiGrid} title={t('files.gridView')} onClick={() => state.setViewMode('grid')} active={state.viewMode === 'grid'} width={26} height={26} size={14} />
            <IconBtn icon={FiList} title={t('files.listView')} onClick={() => state.setViewMode('list')} active={state.viewMode === 'list'} width={26} height={26} size={14} />
          </div>
        </div>

        {/* Breadcrumb */}
        <div
          style={{
            padding: '0 16px',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-3)',
              paddingRight: 10,
              marginRight: 4,
              borderRight: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            {displayFiles.length} {displayFiles.length === 1 ? 'item' : 'items'}
          </div>
          <div
            className="tc-breadcrumb-scroll"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flex: 1,
              minWidth: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'thin',
            }}
          >
            <button
              onClick={() => {
                setGlobalSearchQuery('');
                navigation.navigateToBreadcrumb(0);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                fontWeight: 500,
                color: !breadcrumbItems?.length && !isGlobalSearch && !usbMode ? 'var(--text)' : 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 'var(--r-xs)',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              <FiHome size={13} />
              {t('files.home')}
            </button>
            {isGlobalSearch ? (
              <>
                <FiChevronRight size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>
                  {t('files.searchColon')} &quot;{globalSearchQuery}&quot;
                </span>
              </>
            ) : usbMode ? (
              <>
                <FiChevronRight size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                <button
                  onClick={() => state.setCurrentPath(`${USB_PREFIX}/${encodeURIComponent(usbParsed.mountpoint)}`)}
                  style={{
                    fontSize: 13,
                    fontWeight: breadcrumbItems.length === 0 ? 600 : 500,
                    color: breadcrumbItems.length === 0 ? 'var(--text)' : 'var(--text-3)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 'var(--r-xs)',
                    fontFamily: 'inherit',
                    flexShrink: 0,
                  }}
                  title={usbParsed.mountpoint}
                >
                  {(usbParsed.mountpoint || '').split('/').filter(Boolean).pop() || usbParsed.mountpoint}
                </button>
                {breadcrumbItems.map((folder, i) => {
                  const isLast = i === breadcrumbItems.length - 1;
                  const subTarget = breadcrumbItems.slice(0, i + 1).join('/');
                  return (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <FiChevronRight size={13} color="var(--text-3)" />
                      <button
                        onClick={() => state.setCurrentPath(`${USB_PREFIX}/${encodeURIComponent(usbParsed.mountpoint)}/${subTarget}`)}
                        style={{
                          fontSize: 13,
                          fontWeight: isLast ? 600 : 500,
                          color: isLast ? 'var(--text)' : 'var(--text-3)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          borderRadius: 'var(--r-xs)',
                          fontFamily: 'inherit',
                        }}
                      >
                        {folder}
                      </button>
                    </span>
                  );
                })}
              </>
            ) : (
              breadcrumbItems?.map((folder, i) => {
                const isLast = i === breadcrumbItems.length - 1;
                const display = folder.startsWith('user_') ? fileUtils.getFolderDisplayName(folder) : folder;
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <FiChevronRight size={13} color="var(--text-3)" />
                    <button
                      onClick={() => navigation.navigateToBreadcrumb(i + 1)}
                      style={{
                        fontSize: 13,
                        fontWeight: isLast ? 600 : 500,
                        color: isLast ? 'var(--text)' : 'var(--text-3)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        borderRadius: 'var(--r-xs)',
                        fontFamily: 'inherit',
                      }}
                    >
                      {display}
                    </button>
                  </span>
                );
              })
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <IconBtn icon={FiArrowLeft} title={t('common.back')} onClick={navigation.goBack} disabled={!navigation.canGoBack} />
            <IconBtn icon={FiArrowRight} title={t('files.forward')} onClick={navigation.goForward} disabled={!navigation.canGoForward} />
            <IconBtn
              icon={FiRefreshCw}
              title={t('common.refresh')}
              onClick={() => state.queryClient.invalidateQueries({ queryKey: ['files', state.currentPath] })}
            />
          </div>
        </div>

        {/* Files area */}
        <div className="files-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {state.viewMode === 'list' ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {!isGlobalSearch && state.isLoading ? (
                  <LoadingPanel label={t('files.loadingFiles')} />
                ) : displayFiles.length === 0 && !state.creatingFolder ? (
                  <EmptyState label={isGlobalSearch ? t('files.noSearchResults') : t('files.noFilesYet')} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div
                      style={{
                        flexShrink: 0,
                        background: 'var(--surface-2)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: isGlobalSearch ? '1fr 1fr 150px' : '1fr 150px 150px 200px',
                          gap: 16,
                          padding: '10px 24px',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.name')}</div>
                        {isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('files.colPath')}</div>}
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.size')}</div>
                        {!isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.modified')}</div>}
                        {!isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'right' }}>{t('common.actions')}</div>}
                      </div>
                    </div>
                    <Suspense fallback={<LoadingPanel />}>
                      <ListView
                        key={state.currentPath}
                        ref={listViewRef}
                        files={displayFiles}
                        creatingFolder={state.creatingFolder}
                        newFolderName={state.newFolderName}
                        onNewFolderNameChange={state.setNewFolderName}
                        onCancelCreateFolder={handlers.cancelCreateFolder}
                        onConfirmCreateFolder={handlers.confirmCreateFolder}
                        deletingFile={state.deletingFile}
                        renamingFile={state.renamingFile}
                        newFileName={state.newFileName}
                        setNewFileName={state.setNewFileName}
                        cancelDelete={handlers.cancelDelete}
                        confirmDelete={() => handlers.confirmDelete(state.deletingFile)}
                        cancelRename={handlers.cancelRename}
                        confirmRename={() => handlers.confirmRename(state.renamingFile, state.newFileName)}
                        processingFile={state.processingFile}
                        handleContextMenu={contextMenu.handleContextMenu}
                        getFileIcon={fileUtils.getFileIcon}
                        navigateToFolder={
                          isGlobalSearch
                            ? (name, file) => {
                                const path = file?._fullPath || file?._parentPath || name;
                                setGlobalSearchQuery('');
                                if (file?.isDirectory) state.setCurrentPath(path);
                                else {
                                  state.setCurrentPath(file?._parentPath || '');
                                  setPendingScrollTarget(name);
                                }
                              }
                            : handleFolderClick
                        }
                        formatFileSize={fileUtils.formatFileSize}
                        openMediaViewer={
                          isGlobalSearch
                            ? (file) => {
                                setGlobalSearchQuery('');
                                state.setCurrentPath(file._parentPath || '');
                                setPendingScrollTarget(file.name);
                              }
                            : readOnly
                            ? () => {}
                            : mediaViewer.openMediaViewer
                        }
                        initiateRename={isGlobalSearch || readOnly ? () => {} : handlers.initiateRename}
                        handleDownload={isGlobalSearch || readOnly ? () => {} : fileUtils.handleDownload}
                        initiateDelete={isGlobalSearch || readOnly ? () => {} : handlers.initiateDelete}
                        initiateShare={isGlobalSearch || readOnly ? undefined : handlers.initiateShare}
                        sharedPaths={isGlobalSearch || readOnly ? undefined : state.sharedPaths}
                        favoritePaths={isGlobalSearch || readOnly ? undefined : favoritePaths}
                        currentPath={state.currentPath}
                        isGlobalSearch={isGlobalSearch}
                        selectionMode={isGlobalSearch || readOnly ? false : state.selectionMode}
                        selectedFiles={selectedFileSet}
                        onToggleSelect={toggleSelection}
                        onPauseDownload={state.pauseDownload}
                        onResumeDownload={state.resumeDownload}
                        onRemoveDownload={state.removeDownload}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {state.isLoading ? (
                  <LoadingPanel label={t('files.loadingFiles')} />
                ) : displayFiles.length === 0 && !state.creatingFolder ? (
                  <EmptyState label={isGlobalSearch ? t('files.noSearchResults') : t('files.noFilesYet')} />
                ) : (
                  <Suspense fallback={<LoadingPanel />}>
                    <GridView
                      key={state.currentPath}
                      ref={gridViewRef}
                      files={displayFiles}
                      creatingFolder={isGlobalSearch ? false : state.creatingFolder}
                      newFolderName={state.newFolderName}
                      onNewFolderNameChange={state.setNewFolderName}
                      onCancelCreateFolder={handlers.cancelCreateFolder}
                      onConfirmCreateFolder={handlers.confirmCreateFolder}
                      deletingFile={state.deletingFile}
                      renamingFile={state.renamingFile}
                      newFileName={state.newFileName}
                      onNewFileNameChange={state.setNewFileName}
                      onCancelRename={handlers.cancelRename}
                      onConfirmRename={() => handlers.confirmRename(state.renamingFile, state.newFileName)}
                      processingFile={state.processingFile}
                      currentPath={state.currentPath}
                      onNavigateToFolder={
                        isGlobalSearch
                          ? (name, file) => {
                              const item = displayFiles.find((f) => f.name === name) || file;
                              setGlobalSearchQuery('');
                              if (item?.isDirectory) state.setCurrentPath(item._fullPath || item._parentPath || name);
                              else {
                                state.setCurrentPath(item?._parentPath || '');
                                setPendingScrollTarget(name);
                              }
                            }
                          : handleFolderClick
                      }
                      onOpenMediaViewer={
                        isGlobalSearch
                          ? (file) => {
                              setGlobalSearchQuery('');
                              state.setCurrentPath(file._parentPath || '');
                              setPendingScrollTarget(file.name);
                            }
                          : readOnly
                          ? () => {}
                          : mediaViewer.openMediaViewer
                      }
                      onInitiateRename={isGlobalSearch || readOnly ? () => {} : handlers.initiateRename}
                      onHandleDownload={isGlobalSearch || readOnly ? () => {} : fileUtils.handleDownload}
                      onInitiateDelete={isGlobalSearch || readOnly ? () => {} : handlers.initiateDelete}
                      onConfirmDelete={() => handlers.confirmDelete(state.deletingFile)}
                      onCancelDelete={handlers.cancelDelete}
                      formatFileSize={fileUtils.formatFileSize}
                      onContextMenu={isGlobalSearch ? undefined : contextMenu.handleContextMenu}
                      onInitiateShare={isGlobalSearch || readOnly ? undefined : handlers.initiateShare}
                      sharedPaths={isGlobalSearch || readOnly ? undefined : state.sharedPaths}
                      favoritePaths={isGlobalSearch || readOnly ? undefined : favoritePaths}
                      selectionMode={isGlobalSearch || readOnly ? false : state.selectionMode}
                      selectedFiles={selectedFileSet}
                      onToggleSelect={toggleSelection}
                      onPauseDownload={state.pauseDownload}
                      onResumeDownload={state.resumeDownload}
                      onRemoveDownload={state.removeDownload}
                      isGlobalSearch={isGlobalSearch}
                    />
                  </Suspense>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile search bar */}
        <div className="tc-mobile-search">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '8px 12px',
              gap: 8,
            }}
          >
            <FiSearch size={14} color="var(--text-3)" />
            <input
              type="text"
              value={state.searchQuery}
              onChange={(e) => state.setSearchQuery(e.target.value)}
              placeholder={t('files.searchFiles')}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            />
          </div>
        </div>
      </main>

      <ContextMenu
        contextMenu={state.contextMenu}
        file={state.selectedContextFile}
        currentPath={state.currentPath}
        onNavigateToFolder={() => {
          handleFolderClick(state.selectedContextFile.name, state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onRename={readOnly ? undefined : () => handlers.initiateRename(state.selectedContextFile)}
        onDownload={readOnly ? undefined : () => {
          fileUtils.handleDownload(state.selectedContextFile.id, state.selectedContextFile.name);
          contextMenu.closeContextMenu();
        }}
        onView={readOnly ? undefined : () => {
          mediaViewer.openMediaViewer(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onDelete={readOnly ? undefined : () => {
          handlers.initiateDelete(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onRestore={() => {
          handlers.confirmRestore(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onShare={readOnly ? undefined : () => {
          handlers.initiateShare(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onToggleFavorite={readOnly ? undefined : async () => {
          if (state.selectedContextFile) {
            const fullPath = state.currentPath
              ? `${state.currentPath}/${state.selectedContextFile.name}`
              : state.selectedContextFile.name;
            try {
              await toggleFavorite({
                path: fullPath,
                name: state.selectedContextFile.name,
                isDirectory: state.selectedContextFile.isDirectory,
              });
              state.addNotification(
                'success',
                favorites.some((f) => f.path === fullPath) ? t('notify.removedFromFavorites') : t('files.addedToFavorites'),
              );
            } catch {
              state.addNotification('error', t('notify.favoritesUpdateFailed'));
            }
          }
          contextMenu.closeContextMenu();
        }}
        isFavorite={
          state.selectedContextFile
            ? favorites.some(
                (f) =>
                  f.path === (state.currentPath ? `${state.currentPath}/${state.selectedContextFile.name}` : state.selectedContextFile.name),
              )
            : false
        }
        onClose={contextMenu.closeContextMenu}
      />

      <Suspense fallback={null}>
        <MediaViewer
          viewerFile={state.viewerFile}
          viewableFiles={state.viewableFiles}
          currentPath={state.currentPath}
          onClose={mediaViewer.closeMediaViewer}
          onNavigate={mediaViewer.navigateViewer}
          onSelectFile={mediaViewer.selectViewerFile}
          onDelete={
            readOnly
              ? undefined
              : (file) => {
                  // Move to an adjacent file before the list refetches so the
                  // viewer stays open; the delete invalidation then refreshes
                  // the list and the thumbnail strip (dropping this file).
                  const list = state.viewableFiles;
                  const idx = list.findIndex((f) => f.id === file.id);
                  const next = list[idx + 1] || list[idx - 1] || null;
                  handlers.confirmDelete(file);
                  if (next) mediaViewer.selectViewerFile(next);
                  else mediaViewer.closeMediaViewer();
                }
          }
        />
      </Suspense>

      <UploadStatus transfers={state.transfers} uploads={state.uploads} />

      {state.sharingFile && (
        <Suspense fallback={null}>
          <ShareModal file={state.sharingFile} currentPath={state.currentPath} onClose={handlers.cancelShare} />
        </Suspense>
      )}

      {moveModalOpen && (
        <Suspense fallback={null}>
          <MoveModal
            open={moveModalOpen}
            title={`Move ${state.selectedFiles.length} item(s)`}
            initialPath={state.currentPath}
            fetchFolders={fetchMoveFolders}
            onConfirm={handleConfirmMove}
            onClose={() => setMoveModalOpen(false)}
          />
        </Suspense>
      )}

      {magnetModalOpen && (
        <Suspense fallback={null}>
          <MagnetModal
            open={magnetModalOpen}
            currentPath={state.currentPath}
            onClose={() => setMagnetModalOpen(false)}
          />
        </Suspense>
      )}

      {pendingLock && (
        <FolderPinModal
          folderPath={pendingLock.path}
          folderName={pendingLock.name}
          onSuccess={handlePinSuccess}
          onCancel={() => setPendingLock(null)}
        />
      )}

      <style jsx>{`
        .tc-mobile-search {
          padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
          background: var(--surface);
          border-top: 1px solid var(--border);
          flex-shrink: 0;
        }
        @media (min-width: 640px) {
          .tc-mobile-search { display: none; }
          [data-show-filter] { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

export default function FilesPage() {
  return <FilesPageContent />;
}
