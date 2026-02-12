/** @format */

'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Suspense, lazy, useMemo, useState } from 'react';
import { FiUpload, FiFolder, FiPlus, FiHome, FiChevronRight, FiGrid, FiList, FiArrowLeft, FiArrowRight, FiRefreshCw, FiSearch, FiCheckSquare, FiImage } from 'react-icons/fi';
import UploadStatus from '@/components/files/UploadStatus';
import ContextMenu from '@/components/files/ContextMenu';
import FavoritesSidebar from '@/components/FavoritesSidebar';
import { useFilesPage } from '@/hooks/useFilesPage';
import { useFileHandlers } from '@/hooks/useFileHandlers';
import { useNavigation, useMediaViewer, useDragAndDrop, useContextMenu, useFileUtils } from '@/hooks/useFileOperations';
import { useFavorites, useToggleFavorite } from '@/lib/api/favorites';
import { useMoveFiles } from '@/lib/api/files';
import { getFileExtension } from '@/lib/clientFileUtils';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const GridView = lazy(() => import('@/components/files/GridView'));
const ListView = lazy(() => import('@/components/files/ListView'));
const ShareModal = lazy(() => import('@/components/files/ShareModal'));
const MoveModal = lazy(() => import('@/components/files/MoveModal'));

function FilesPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Get all state and helpers from custom hook
  const state = useFilesPage(status, session);

  // Navigation hooks
  const navigation = useNavigation({
    currentPath: state.currentPath,
    pathHistory: state.pathHistory,
    historyIndex: state.historyIndex,
    setCurrentPath: state.setCurrentPath,
    setPathHistory: state.setPathHistory,
    setHistoryIndex: state.setHistoryIndex,
  });

  // Media viewer hooks
  const mediaViewer = useMediaViewer({
    viewerFile: state.viewerFile,
    viewableFiles: state.viewableFiles,
    setViewerFile: state.setViewerFile,
  });

  // Drag and drop hooks
  const dragDrop = useDragAndDrop({
    setIsDragging: state.setIsDragging,
  });

  // Context menu hooks
  const contextMenu = useContextMenu({
    setContextMenu: state.setContextMenu,
    setSelectedContextFile: state.setSelectedContextFile,
  });

  // File utilities
  const fileUtils = useFileUtils({
    currentPath: state.currentPath,
    folderDisplayNames: state.folderDisplayNames,
  });

  // Favorites
  const { data: favorites = [] } = useFavorites();
  const { toggleFavorite, isPending: togglingFavorite } = useToggleFavorite();
  const moveMutation = useMoveFiles();
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [convertingHeic, setConvertingHeic] = useState(false);
  const [conversionStatus, setConversionStatus] = useState({ completed: 0, total: 0, failed: [] });

  // File operation handlers
  const handlers = useFileHandlers({
    currentPath: state.currentPath,
    setCreatingFolder: state.setCreatingFolder,
    setNewFolderName: state.setNewFolderName,
    newFolderName: state.newFolderName,
    addNotification: state.addNotification,
    setUploads: state.setUploads,
    setUploading: state.setUploading,
    setDeletingFile: state.setDeletingFile,
    setProcessingFile: state.setProcessingFile,
    setRenamingFile: state.setRenamingFile,
    setNewFileName: state.setNewFileName,
    setSharingFile: state.setSharingFile,
    setRestoringFile: state.setRestoringFile,
  });

  const selectedFileSet = useMemo(() => new Set(state.selectedFiles), [state.selectedFiles]);

  // Detect HEIC files in current folder
  const heicFiles = useMemo(() => {
    return state.files
      .filter(f => {
        if (f.isDirectory) return false;
        const ext = getFileExtension(f.name);
        return ext === 'heic' || ext === 'heif';
      })
      .map(f => f.name);
  }, [state.files]);

  const hasHeicFiles = heicFiles.length > 0;

  const toggleSelection = (file) => {
    state.setSelectedFiles((prev) => {
      if (prev.includes(file.name)) {
        return prev.filter((name) => name !== file.name);
      }
      return [...prev, file.name];
    });
  };

  const fetchMoveFolders = async (path) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load folders');
    }
    return (data.files || []).filter((file) => file.isDirectory);
  };

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
    setConversionStatus({ completed: 0, total: heicFiles.length, failed: [] });

    const failed = [];

    for (let i = 0; i < heicFiles.length; i++) {
      const fileName = heicFiles[i];

      try {
        // Build URL with format=jpeg parameter and 0x0 to preserve original resolution
        const params = new URLSearchParams({
          path: state.currentPath,
          format: 'jpeg',
          quality: '100',
          w: '0',
          h: '0'
        });

        const response = await fetch(`/api/files/optimize-image/${encodeURIComponent(fileName)}?${params}`);

        if (!response.ok) {
          throw new Error(`Failed to convert ${fileName}`);
        }

        // Download the converted file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.replace(/\.(heic|heif)$/i, '.jpeg');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        // Update progress
        setConversionStatus(prev => ({
          ...prev,
          completed: prev.completed + 1
        }));

        // Small delay between downloads to avoid browser blocking
        if (i < heicFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error(`Failed to convert ${fileName}:`, error);
        failed.push(fileName);
        setConversionStatus(prev => ({
          ...prev,
          completed: prev.completed + 1,
          failed: [...prev.failed, fileName]
        }));
      }
    }

    // Show completion notification
    setTimeout(() => {
      const successCount = heicFiles.length - failed.length;
      if (failed.length === 0) {
        state.addNotification('success', `Successfully converted ${successCount} HEIC file(s) to JPEG`);
      } else {
        state.addNotification('warning',
          `Converted ${successCount}/${heicFiles.length} files. ${failed.length} failed: ${failed.join(', ')}`
        );
      }
      setConvertingHeic(false);
      setConversionStatus({ completed: 0, total: 0, failed: [] });
    }, 1000);
  };

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-900 flex overflow-hidden" onClick={contextMenu.closeContextMenu}>
      {/* Favorites Sidebar - hidden on mobile */}
      <div className="hidden sm:block">
        <FavoritesSidebar
          onNavigate={(path) => state.setCurrentPath(path)}
          currentPath={state.currentPath}
        />
      </div>

      {/* Main Content */}
      <main
        className="flex-1 overflow-y-auto w-full px-1 sm:px-1 lg:px-4 py-1 sm:py-1 pb-16 sm:pb-1 flex flex-col relative"
        onDragOver={dragDrop.handleDragOver}
        onDragLeave={dragDrop.handleDragLeave}
        onDrop={(e) => dragDrop.handleDropEvent(e, handlers.handleDrop)}
      >
        {/* Drag and Drop Overlay */}
        {state.isDragging && (
          <div className="absolute inset-0 z-40 bg-indigo-500 bg-opacity-10 border-4 border-dashed border-indigo-500 rounded-lg flex items-center justify-center pointer-events-none">
            <div className="bg-gray-800 rounded-lg p-8 shadow-2xl">
              <div className="text-center">
                <FiUpload className="mx-auto text-indigo-400 mb-4" size={64} />
                <p className="text-2xl font-semibold text-white mb-2">Drop files here</p>
                <p className="text-gray-400">Release to upload to current folder</p>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar Navbar */}
        <div className="sm:mt-2 flex flex-col sm:flex-row sm:justify-between gap-2 sm:gap-4 bg-gray-800 p-2 sm:p-4 rounded-lg shadow">
          {/* Left Group: Actions + Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 bg-gray-700 rounded-lg p-1">
              {/* Upload Button */}
              <label className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 rounded text-gray-300 hover:bg-gray-600 cursor-pointer text-xs sm:text-base transition-colors">
              <FiUpload size={16} />
              <span className="hidden sm:inline">{state.uploading ? 'Uploading...' : 'Upload'}</span>
              <input type="file" className="hidden" multiple onChange={handlers.handleUpload} disabled={state.uploading} />
              </label>

              {/* Selection Mode */}
              <button
                onClick={() => state.setSelectionMode(!state.selectionMode)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 rounded text-xs sm:text-base transition-colors ${state.selectionMode ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
              >
                <FiCheckSquare size={16} />
                <span className="hidden sm:inline">{state.selectionMode ? 'Selecting' : 'Select'}</span>
              </button>

              {state.selectionMode && (
                <button
                  onClick={() => setMoveModalOpen(true)}
                  disabled={state.selectedFiles.length === 0 || moveMutation.isPending}
                  className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 rounded text-gray-300 hover:bg-gray-600 text-xs sm:text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FiFolder size={16} />
                  <span className="hidden sm:inline">Move ({state.selectedFiles.length})</span>
                </button>
              )}

              {/* HEIC to JPEG Conversion Button */}
              {hasHeicFiles && (
                <button
                  onClick={handleConvertHeicToJpeg}
                  disabled={convertingHeic}
                  className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 rounded text-xs sm:text-base transition-colors text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Convert ${heicFiles.length} HEIC file(s) to JPEG`}
                >
                  <FiImage size={16} />
                  <span className="hidden sm:inline">
                    {convertingHeic
                      ? `Converting ${conversionStatus.completed}/${conversionStatus.total}...`
                      : `HEIC→JPEG (${heicFiles.length})`
                    }
                  </span>
                  <span className="sm:hidden">
                    {convertingHeic
                      ? `${conversionStatus.completed}/${conversionStatus.total}`
                      : `HEIC→JPEG`
                    }
                  </span>
                </button>
              )}

              {/* New Folder Button */}
              <button
                onClick={handlers.initiateCreateFolder}
                className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 rounded text-gray-300 hover:bg-gray-600 text-xs sm:text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={state.creatingFolder}
              >
                <FiPlus size={16} />
                <span className="hidden sm:inline">New Folder</span>
              </button>

              <button
                onClick={navigation.goBack}
                disabled={!navigation.canGoBack}
                className={`p-2 rounded ${!navigation.canGoBack ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-gray-600'}`}
                title="Go Back"
              >
                <FiArrowLeft size={20} />
              </button>
              <button
                onClick={navigation.goForward}
                disabled={!navigation.canGoForward}
                className={`p-2 rounded ${!navigation.canGoForward ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-gray-600'}`}
                title="Go Forward"
              >
                <FiArrowRight size={20} />
              </button>

              <button
                onClick={() => state.queryClient.invalidateQueries({ queryKey: ['files', state.currentPath] })}
                className="p-2 text-gray-400 hover:bg-gray-600 rounded"
                title="Refresh"
              >
                <FiRefreshCw size={20} />
              </button>
            </div>

            {/* Search Input - hidden on mobile */}
            <div className="relative hidden sm:flex flex-1 sm:flex-none min-w-0 sm:min-w-48 items-center px-3 bg-gray-700 rounded-lg">
              <FiSearch className="absolute text-gray-400 flex-shrink-0" size={16} />
              <input
                type="text"
                value={state.searchQuery}
                onChange={(e) => state.setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-6 pr-2 py-1 sm:py-2 bg-transparent text-white text-xs sm:text-base placeholder-gray-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Right Group: Sort, Back, Refresh, View Toggle */}
          <div className="flex gap-1 sm:gap-2 flex-wrap items-center ml-auto">
            {/* Sort Dropdown */}
            <div className="bg-gray-700 rounded-lg p-1">
              <select
                value={state.sortBy}
                onChange={(e) => state.setSortBy(e.target.value)}
                className="px-2 sm:px-3 py-1 sm:py-2 text-xs sm:text-base bg-transparent text-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="date-desc">Date (New)</option>
                <option value="date-asc">Date (Old)</option>
                <option value="size-desc">Size (Big)</option>
                <option value="size-asc">Size (Small)</option>
              </select>
            </div>

            {/* View Toggle */}
            <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => state.setViewMode('list')}
                className={`p-2 rounded ${state.viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}
                title="List View"
              >
                <FiList size={20} />
              </button>
              <button
                onClick={() => state.setViewMode('grid')}
                className={`p-2 rounded ${state.viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}
                title="Grid View"
              >
                <FiGrid size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Breadcrumb Navigation */}
        <div className="mb-1 mt-1 sm:mb-2 flex items-center gap-2 sm:gap-3  text-gray-400">
          <button onClick={() => navigation.navigateToBreadcrumb(0)} className="flex items-center gap-1.5 hover:text-indigo-400 whitespace-nowrap">
            <FiHome size={16} />
            <span className="hidden sm:inline">Home</span>
          </button>
          {state.currentPath &&
            state.currentPath.split('/').map((folder, index, arr) => {
              const displayName = folder.startsWith('user_') ? fileUtils.getFolderDisplayName(folder) : folder;
              return (
                <div key={index} className="flex items-center gap-1.5 sm:gap-2">
                  <FiChevronRight size={14} className="text-gray-600 flex-shrink-0" />
                  <button
                    onClick={() => navigation.navigateToBreadcrumb(index + 1)}
                    className={`hover:text-indigo-400 truncate ${index === arr.length - 1 ? 'font-medium text-white' : ''}`}
                  >
                    {displayName}
                  </button>
                </div>
              );
            })}
        </div>
        {/* File Grid */}
        <div className="bg-gray-800 rounded-lg shadow overflow-y-auto flex-grow-1 flex flex-col">
          {state.viewMode === 'list' ? (
            /* List View with Virtual Scrolling */
            <div className="overflow-hidden flex-grow flex flex-col">
              {state.isLoading ? (
                <div className="flex items-center justify-center flex-grow">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2  text-gray-400">Loading files...</p>
                  </div>
                </div>
              ) : state.files.length === 0 && !state.creatingFolder ? (
                <div className="flex items-center justify-center flex-grow text-gray-400">No files yet. Upload your first file!</div>
              ) : (
                <div className="flex flex-col flex-grow overflow-hidden">
                  <div className="flex-shrink-0 bg-gray-700 border-b border-gray-700">
                    <div className="grid grid-cols-[1fr_150px_150px_200px] gap-4 px-6 py-3">
                      <div className="text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Name</div>
                      <div className="text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Size</div>
                      <div className="text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Modified</div>
                      <div className="text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</div>
                    </div>
                  </div>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center flex-grow">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                    }
                  >
                    <ListView
                      files={state.files}
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
                      navigateToFolder={navigation.navigateToFolder}
                      formatFileSize={fileUtils.formatFileSize}
                      openMediaViewer={mediaViewer.openMediaViewer}
                      initiateRename={handlers.initiateRename}
                      handleDownload={fileUtils.handleDownload}
                      initiateDelete={handlers.initiateDelete}
                      initiateShare={handlers.initiateShare}
                      sharedPaths={state.sharedPaths}
                      currentPath={state.currentPath}
                      selectionMode={state.selectionMode}
                      selectedFiles={selectedFileSet}
                      onToggleSelect={toggleSelection}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          ) : (
            /* Grid View with Virtual Scrolling */
            <div className="p-0 flex flex-col flex-grow">
              {state.isLoading ? (
                <div className="flex items-center justify-center flex-grow">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2  text-gray-400">Loading files...</p>
                  </div>
                </div>
              ) : state.files.length === 0 && !state.creatingFolder ? (
                <div className="text-center py-12 text-gray-400">No files yet. Upload your first file!</div>
              ) : (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center flex-grow">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                  }
                >
                  <GridView
                    files={state.files}
                    creatingFolder={state.creatingFolder}
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
                    onNavigateToFolder={navigation.navigateToFolder}
                    onOpenMediaViewer={mediaViewer.openMediaViewer}
                    onInitiateRename={handlers.initiateRename}
                    onHandleDownload={fileUtils.handleDownload}
                    onInitiateDelete={handlers.initiateDelete}
                    onConfirmDelete={() => handlers.confirmDelete(state.deletingFile)}
                    onCancelDelete={handlers.cancelDelete}
                    formatFileSize={fileUtils.formatFileSize}
                    onContextMenu={contextMenu.handleContextMenu}
                    onInitiateShare={handlers.initiateShare}
                    sharedPaths={state.sharedPaths}
                    selectionMode={state.selectionMode}
                    selectedFiles={selectedFileSet}
                    onToggleSelect={toggleSelection}
                  />
                </Suspense>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Context Menu */}
      <ContextMenu
        contextMenu={state.contextMenu}
        file={state.selectedContextFile}
        currentPath={state.currentPath}
        onNavigateToFolder={() => {
          navigation.navigateToFolder(state.selectedContextFile.name);
          contextMenu.closeContextMenu();
        }}
        onRename={() => {
          handlers.initiateRename(state.selectedContextFile);
        }}
        onDownload={() => {
          fileUtils.handleDownload(state.selectedContextFile.id, state.selectedContextFile.name);
          contextMenu.closeContextMenu();
        }}
        onView={() => {
          mediaViewer.openMediaViewer(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onDelete={() => {
          handlers.initiateDelete(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onRestore={() => {
          handlers.confirmRestore(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onShare={() => {
          handlers.initiateShare(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
        onToggleFavorite={async () => {
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
              state.addNotification('success', favorites.some(f => f.path === fullPath) ? 'Removed from favorites' : 'Added to favorites');
            } catch (error) {
              state.addNotification('error', 'Failed to update favorites');
            }
          }
          contextMenu.closeContextMenu();
        }}
        isFavorite={state.selectedContextFile ? favorites.some(f => f.path === (state.currentPath ? `${state.currentPath}/${state.selectedContextFile.name}` : state.selectedContextFile.name)) : false}
        onClose={contextMenu.closeContextMenu}
      />

      {/* Media Viewer Modal */}
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

      {/* Mobile Search Bar - fixed at bottom, semi-transparent */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 p-2 bg-gray-800/80 backdrop-blur-sm border-t border-gray-700 z-30">
        <div className="relative flex items-center bg-gray-700 rounded-lg px-3 py-2">
          <FiSearch className="text-gray-400 flex-shrink-0 mr-2" size={16} />
          <input
            type="text"
            value={state.searchQuery}
            onChange={(e) => state.setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-transparent text-white text-sm placeholder-gray-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Upload Status */}
      <UploadStatus uploads={state.uploads} />

      {/* Share Modal */}
      {state.sharingFile && (
        <Suspense fallback={null}>
          <ShareModal
            file={state.sharingFile}
            currentPath={state.currentPath}
            onClose={handlers.cancelShare}
          />
        </Suspense>
      )}

      {/* Move Modal */}
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
    </div>
  );
}

// Wrap with Suspense for useSearchParams
export default function FilesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-gray-900">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <FilesPageContent />
    </Suspense>
  );
}
