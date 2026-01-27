/** @format */

'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Suspense, lazy } from 'react';
import { FiUpload, FiFolder, FiPlus, FiHome, FiChevronRight, FiGrid, FiList, FiArrowLeft, FiRefreshCw, FiSearch } from 'react-icons/fi';
import UploadStatus from '@/components/files/UploadStatus';
import ContextMenu from '@/components/files/ContextMenu';
import { useFilesPage } from '@/hooks/useFilesPage';
import { useFileHandlers } from '@/hooks/useFileHandlers';
import { useNavigation, useMediaViewer, useDragAndDrop, useContextMenu, useFileUtils } from '@/hooks/useFileOperations';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const GridView = lazy(() => import('@/components/files/GridView'));
const ListView = lazy(() => import('@/components/files/ListView'));
const ShareModal = lazy(() => import('@/components/files/ShareModal'));

export default function FilesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Get all state and helpers from custom hook
  const state = useFilesPage(status, session);

  // Navigation hooks
  const navigation = useNavigation({
    currentPath: state.currentPath,
    pathHistory: state.pathHistory,
    setCurrentPath: state.setCurrentPath,
    setPathHistory: state.setPathHistory,
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
  });

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
    <div className="w-full h-full bg-gray-900 flex flex-col overflow-hidden" onClick={contextMenu.closeContextMenu}>
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
          {/* Left Group: Upload, New Folder, Search */}
          <div className="flex gap-0 flex-wrap bg-gray-700 rounded-lg border border-gray-600 overflow-hidden">
            {/* Upload Button */}
            <label className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 text-gray-300 hover:bg-gray-600 cursor-pointer text-xs sm:text-base transition-colors border-r border-gray-600 last:border-r-0">
              <FiUpload size={16} />
              <span className="hidden sm:inline">{state.uploading ? 'Uploading...' : 'Upload'}</span>
              <input type="file" className="hidden" onChange={handlers.handleUpload} disabled={state.uploading} />
            </label>

            {/* New Folder Button */}
            <button
              onClick={handlers.initiateCreateFolder}
              className="flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-2 text-gray-300 hover:bg-gray-600 text-xs sm:text-base transition-colors border-r border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state.creatingFolder}
            >
              <FiPlus size={16} />
              <span className="hidden sm:inline">New Folder</span>
            </button>
            <button
              onClick={navigation.goBack}
              disabled={state.pathHistory.length <= 1}
              className={`p-2 rounded-lg ${state.pathHistory.length <= 1 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-gray-700'}`}
              title="Go Back"
            >
              <FiArrowLeft size={20} />
            </button>

            <button
              onClick={() => state.queryClient.invalidateQueries({ queryKey: ['files', state.currentPath] })}
              className="p-2 text-gray-400 hover:bg-gray-700 rounded-lg"
              title="Refresh"
            >
              <FiRefreshCw size={20} />
            </button>
            {/* Search Input - hidden on mobile */}
            <div className="relative hidden sm:flex flex-1 sm:flex-none min-w-0 sm:min-w-48 items-center px-3">
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
            <select
              value={state.sortBy}
              onChange={(e) => state.setSortBy(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-2 text-xs sm: bg-gray-700 text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="date-desc">Date (New)</option>
              <option value="date-asc">Date (Old)</option>
              <option value="size-desc">Size (Big)</option>
              <option value="size-asc">Size (Small)</option>
            </select>

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
                      confirmDelete={handlers.confirmDelete}
                      cancelRename={handlers.cancelRename}
                      confirmRename={handlers.confirmRename}
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
                    onConfirmRename={handlers.confirmRename}
                    processingFile={state.processingFile}
                    currentPath={state.currentPath}
                    onNavigateToFolder={navigation.navigateToFolder}
                    onOpenMediaViewer={mediaViewer.openMediaViewer}
                    onInitiateRename={handlers.initiateRename}
                    onHandleDownload={fileUtils.handleDownload}
                    onInitiateDelete={handlers.initiateDelete}
                    onConfirmDelete={handlers.confirmDelete}
                    onCancelDelete={handlers.cancelDelete}
                    formatFileSize={fileUtils.formatFileSize}
                    onContextMenu={contextMenu.handleContextMenu}
                    onInitiateShare={handlers.initiateShare}
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
        onShare={() => {
          handlers.initiateShare(state.selectedContextFile);
          contextMenu.closeContextMenu();
        }}
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
    </div>
  );
}
