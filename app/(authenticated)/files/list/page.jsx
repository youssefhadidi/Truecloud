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

const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const GridView = lazy(() => import('@/components/files/GridView'));
const ListView = lazy(() => import('@/components/files/ListView'));
const ShareModal = lazy(() => import('@/components/files/ShareModal'));
const MoveModal = lazy(() => import('@/components/files/MoveModal'));

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
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [convertingHeic, setConvertingHeic] = useState(false);

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
    if (failed === 0) state.addNotification('success', `Deleted ${succeeded} item(s)`);
    else state.addNotification('warning', `Deleted ${succeeded}, failed to delete ${failed}`);
  }, [bulkDeleting, bulkDeleteMutation, state]);

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
        const url = `/api/files/optimize-image/${encodeURIComponent(fileName)}?${params}`;
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
      state.addNotification('success', `Downloaded ${state.selectedFiles.length} file(s) as JPEG`);
    } else {
      state.addNotification('warning', `Failed ${failed.length} file(s): ${failed.join(', ')}`);
    }
  }, [state, handleShareOrDownload]);

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

  useEffect(() => {
    if (!state.selectionMode) return;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      state.setSelectionMode(false);
      state.setSelectedFiles([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectionMode, state.setSelectionMode, state.setSelectedFiles]);

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
      state.addNotification('error', 'Select a different destination');
      return;
    }
    try {
      await moveMutation.mutateAsync({
        items: state.selectedFiles,
        sourcePath: state.currentPath,
        destinationPath,
      });
      state.addNotification('success', `Moved ${state.selectedFiles.length} item(s)`);
      state.setSelectionMode(false);
      setMoveModalOpen(false);
    } catch (error) {
      const message = error?.response?.data?.error || error.message || 'Failed to move items';
      state.addNotification('error', message, 'Move Error');
    }
  };

  const handleConvertHeicToJpeg = async () => {
    if (heicFiles.length === 0) return;
    setConvertingHeic(true);
    try {
      const params = new URLSearchParams({
        path: state.currentPath,
      });
      const zipUrl = `/api/files/heic-to-jpeg-zip?${params}`;
      const folderName = (state.currentPath || '').split('/').filter(Boolean).pop() || 'heic-to-jpeg';
      await handleShareOrDownload(zipUrl, `${folderName}-jpeg.zip`);
      state.addNotification('success', `Preparing ZIP of ${heicFiles.length} HEIC file(s) — download will start shortly`);
    } catch (error) {
      console.error('HEIC to JPEG zip failed:', error);
      state.addNotification('error', 'Failed to start HEIC to JPEG conversion');
    } finally {
      setTimeout(() => setConvertingHeic(false), 1500);
    }
  };

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <LoadingPanel label="Loading…" />
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
              <div style={{ fontSize: 18, fontWeight: 700 }}>Drop files to upload</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                Files will be uploaded to current folder
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
                {state.uploading ? 'Uploading…' : 'Upload'}
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
                New Folder
              </Btn>
              <Btn
                variant={state.selectionMode ? 'primary' : 'surface'}
                size="sm"
                onClick={() => state.setSelectionMode(!state.selectionMode)}
              >
                <FiCheckSquare size={13} />
                {state.selectionMode ? 'Selecting' : 'Select'}
              </Btn>

              {state.selectionMode && (
                <>
                  <Divider vertical />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
                    {state.selectedFiles.length} selected
                  </span>
                  <Btn
                    variant="surface"
                    size="sm"
                    onClick={handleToggleSelectAll}
                    disabled={selectableFiles.length === 0 || bulkDeleting}
                  >
                    {allSelected ? <FiSquare size={13} /> : <FiCheckSquare size={13} />}
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </Btn>
                  <IconBtn
                    icon={FiDownload}
                    title="Download selected"
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
                        ? 'Downloading…'
                        : `Download as JPEG (${state.selectedFiles.length})`}
                    </Btn>
                  )}
                  <IconBtn
                    icon={FiFolder}
                    title="Move selected"
                    disabled={state.selectedFiles.length === 0 || moveMutation.isPending}
                    onClick={() => setMoveModalOpen(true)}
                  />
                  {bulkDeleteConfirming ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                        Delete {state.selectedFiles.length}?
                      </span>
                      <Btn variant="danger" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                        {bulkDeleting ? 'Deleting…' : 'Confirm'}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setBulkDeleteConfirming(false)} disabled={bulkDeleting}>
                        Cancel
                      </Btn>
                    </>
                  ) : (
                    <IconBtn
                      icon={FiTrash2}
                      title="Delete selected"
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
                    ? `Preparing ZIP…`
                    : `HEIC → JPEG ZIP (${heicFiles.length})`}
                </Btn>
              )}
            </>
          )}

          {isGlobalSearch && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
              <FiSearch size={14} />
              Search Results ({searchFiles.length})
            </span>
          )}

          {readOnly && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
              USB Drive (read-only)
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
              placeholder="Filter…"
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
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
            <option value="date-desc">Date (New)</option>
            <option value="date-asc">Date (Old)</option>
            <option value="size-desc">Size (Big)</option>
            <option value="size-asc">Size (Small)</option>
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
            <IconBtn icon={FiGrid} title="Grid view" onClick={() => state.setViewMode('grid')} active={state.viewMode === 'grid'} width={26} height={26} size={14} />
            <IconBtn icon={FiList} title="List view" onClick={() => state.setViewMode('list')} active={state.viewMode === 'list'} width={26} height={26} size={14} />
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
              Home
            </button>
            {isGlobalSearch ? (
              <>
                <FiChevronRight size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>
                  Search: &quot;{globalSearchQuery}&quot;
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
            <IconBtn icon={FiArrowLeft} title="Back" onClick={navigation.goBack} disabled={!navigation.canGoBack} />
            <IconBtn icon={FiArrowRight} title="Forward" onClick={navigation.goForward} disabled={!navigation.canGoForward} />
            <IconBtn
              icon={FiRefreshCw}
              title="Refresh"
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
                  <LoadingPanel label="Loading files…" />
                ) : displayFiles.length === 0 && !state.creatingFolder ? (
                  <EmptyState label={isGlobalSearch ? 'No search results' : 'No files yet. Upload your first file!'} />
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
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Name</div>
                        {isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Path</div>}
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Size</div>
                        {!isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Modified</div>}
                        {!isGlobalSearch && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'right' }}>Actions</div>}
                      </div>
                    </div>
                    <Suspense fallback={<LoadingPanel />}>
                      <ListView
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
                            : navigation.navigateToFolder
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
                  <LoadingPanel label="Loading files…" />
                ) : displayFiles.length === 0 && !state.creatingFolder ? (
                  <EmptyState label={isGlobalSearch ? 'No search results' : 'No files yet. Upload your first file!'} />
                ) : (
                  <Suspense fallback={<LoadingPanel />}>
                    <GridView
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
                          : navigation.navigateToFolder
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
              placeholder="Search files…"
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
          navigation.navigateToFolder(state.selectedContextFile.name);
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
                favorites.some((f) => f.path === fullPath) ? 'Removed from favorites' : 'Added to favorites',
              );
            } catch {
              state.addNotification('error', 'Failed to update favorites');
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
