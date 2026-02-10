/** @format */

'use client';

import { use, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FiLock, FiFile, FiFolder, FiUpload, FiDownload, FiGrid, FiList } from 'react-icons/fi';
import { useSharePage } from '@/hooks/useSharePage';
import { useShareOperations } from '@/hooks/useShareOperations';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const ContextMenu = lazy(() => import('@/components/files/ContextMenu'));
const Viewer3D = lazy(() => import('@/components/files/Viewer3D'));
const SkpViewer = lazy(() => import('@/components/files/SkpViewer'));
const XlsxViewer = lazy(() => import('@/components/files/XlsxViewer'));
const ShareGrid = lazy(() => import('@/components/files/ShareGrid'));
const ShareList = lazy(() => import('@/components/files/ShareList'));

const isSkp = (fileName) => fileName?.toLowerCase().endsWith('.skp');

export default function SharePage({ params }) {
  const { token } = use(params);
  const fileInputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [submittedPassword, setSubmittedPassword] = useState('');
  const [shareFiles, setShareFiles] = useState([]);

  // Fetch share metadata
  const {
    data: shareResponse,
    isLoading: loading,
    error: shareError,
  } = useQuery({
    queryKey: ['share', token, submittedPassword],
    queryFn: async () => {
      const headers = submittedPassword ? { 'x-share-password': submittedPassword } : {};
      const res = await fetch(`/api/public/${token}`, { headers });
      const data = await res.json();
      if (!res.ok && data.requiresPassword) {
        return { requiresPassword: true, fileName: data.fileName, isDirectory: data.isDirectory };
      }
      if (!res.ok) throw new Error(data.error || 'Share not found');
      return data;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Use share hooks for state management
  const shareState = useSharePage(token, shareResponse ? { ...shareResponse, files: shareFiles } : null);

  // Fetch directory listing
  const { data: directoryFiles = null } = useQuery({
    queryKey: ['share-files', token, submittedPassword, shareState.currentSubPath],
    queryFn: async () => {
      const headers = submittedPassword ? { 'x-share-password': submittedPassword } : {};
      const params = new URLSearchParams();
      if (shareState.currentSubPath) {
        params.append('path', shareState.currentSubPath);
      }
      const url = params.toString() ? `/api/public/${token}/files?${params.toString()}` : `/api/public/${token}/files`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load files');
      return data.files;
    },
    enabled: !!shareResponse && !shareResponse.requiresPassword && !!shareResponse.isDirectory,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (directoryFiles) {
      setShareFiles(directoryFiles);
      return;
    }
    if (directoryFiles === null) {
      setShareFiles([]);
    }
  }, [directoryFiles]);

  // Create operations hook
  const operations = useShareOperations({
    token,
    sharePassword: submittedPassword,
    currentSubPath: shareState.currentSubPath,
    setCurrentSubPath: shareState.setCurrentSubPath,
    setPathHistory: shareState.setPathHistory,
    setHistoryIndex: shareState.setHistoryIndex,
    pathHistory: shareState.pathHistory,
    historyIndex: shareState.historyIndex,
    setCreatingFolder: shareState.setCreatingFolder,
    setNewFolderName: shareState.setNewFolderName,
    newFolderName: shareState.newFolderName,
    setDeletingFile: shareState.setDeletingFile,
    setRenamingFile: shareState.setRenamingFile,
    setNewFileName: shareState.setNewFileName,
    setProcessingFile: shareState.setProcessingFile,
    setViewerFile: shareState.setViewerFile,
    viewerFile: shareState.viewerFile,
    viewableFiles: shareState.viewableFiles,
    setContextMenu: shareState.setContextMenu,
    setSelectedContextFile: shareState.setSelectedContextFile,
    setUploadingFiles: shareState.setUploadingFiles,
    addNotification: shareState.addNotification,
    allowUploads: shareResponse?.allowUploads ?? false,
  });

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setSubmittedPassword(password);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Error state
  if (shareError) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-900">
        <div className="bg-gray-800 rounded-lg shadow-lg p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <FiFile className="text-red-500" size={32} />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Share Not Found</h2>
          <p className="text-gray-400">{shareError.message}</p>
        </div>
      </div>
    );
  }

  // Password entry form
  if (shareResponse?.requiresPassword) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-900">
        <div className="bg-gray-800 rounded-lg shadow-lg p-8 max-w-md w-full mx-4">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <FiLock className="text-indigo-500" size={32} />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Password Protected</h2>
            <p className="text-gray-400">This {shareResponse?.isDirectory ? 'folder' : 'file'} is password protected.</p>
            {shareResponse?.fileName && <p className="text-sm text-gray-300 mt-2 font-medium">{shareResponse.fileName}</p>}
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-700 text-white"
                placeholder="Enter password"
                autoFocus
              />
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Single file view
  if (shareResponse && !shareResponse.isDirectory) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-900 p-4">
        <div className="bg-gray-800 rounded-lg shadow-lg p-8 max-w-2xl w-full max-h-dvh overflow-auto">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-white mb-4">{shareResponse.fileName}</h2>
            <p className="text-gray-400 mb-6">{shareResponse.size ? `${Math.round(shareResponse.size / 1024 / 1024)}MB` : 'Unknown size'}</p>

            {isImage(shareResponse.fileName) && (
              <img
                src={`/api/public/${token}/optimize-image?quality=85&w=1200&h=1200${submittedPassword ? `&pwd=${encodeURIComponent(submittedPassword)}` : ''}`}
                alt={shareResponse.fileName}
                className="max-w-full max-h-[500px] mx-auto object-contain mb-6 rounded"
              />
            )}

            {(isVideo(shareResponse.fileName) || isAudio(shareResponse.fileName) || isPdf(shareResponse.fileName)) && (
              <div className="mb-6 rounded overflow-hidden">
                {isVideo(shareResponse.fileName) && (
                  <video controls className="w-full max-h-[500px]" src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}>
                    Your browser does not support video playback.
                  </video>
                )}
                {isAudio(shareResponse.fileName) && (
                  <audio controls className="w-full" src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}>
                    Your browser does not support audio playback.
                  </audio>
                )}
                {isPdf(shareResponse.fileName) && (
                  <iframe
                    src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}
                    className="w-full h-[500px]"
                    title={shareResponse.fileName}
                  />
                )}
              </div>
            )}

            {is3dFile(shareResponse.fileName) && !isSkp(shareResponse.fileName) && (
              <div className="mb-6 rounded overflow-hidden h-[500px]">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading 3D viewer...</div>}>
                  <Viewer3D fileName={shareResponse.fileName} currentPath="" shareToken={token} sharePassword={submittedPassword} />
                </Suspense>
              </div>
            )}

            {isSkp(shareResponse.fileName) && (
              <div className="mb-6 rounded overflow-hidden h-[500px]">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading 3D viewer...</div>}>
                  <SkpViewer fileName={shareResponse.fileName} currentPath="" shareToken={token} sharePassword={submittedPassword} />
                </Suspense>
              </div>
            )}

            {isXlsx(shareResponse.fileName) && (
              <div className="mb-6 rounded overflow-hidden h-[500px]">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading spreadsheet...</div>}>
                  <XlsxViewer fileName={shareResponse.fileName} currentPath="" shareToken={token} sharePassword={submittedPassword} />
                </Suspense>
              </div>
            )}

            <button
              onClick={() => operations.handleDownload({ name: shareResponse.fileName })}
              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <FiDownload size={20} />
              Download
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Directory view
  if (shareResponse?.isDirectory && directoryFiles) {
    return (
      <div
        className="h-dvh flex flex-col bg-gray-900 text-white"
        onClick={operations.closeContextMenu}
        onDragOver={operations.handleDragOver}
        onDragLeave={operations.handleDragLeave}
        onDrop={operations.handleDropEvent}
      >
        {/* Drag overlay */}
        {shareState.isDragging && shareResponse.allowUploads && (
          <div className="absolute inset-0 bg-indigo-600/20 border-2 border-dashed border-indigo-500 z-50 flex items-center justify-center">
            <div className="bg-gray-800 rounded-lg p-8 shadow-lg text-center">
              <FiUpload className="text-indigo-500 mx-auto mb-3" size={48} />
              <p className="text-lg font-medium">Drop files to upload</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="border-b border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FiFolder className="text-blue-400" size={32} />
              <div>
                <h1 className="text-2xl font-bold">{shareResponse.fileName}</h1>
                <p className="text-sm text-gray-400">Shared by {shareResponse.ownerUsername}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {shareResponse.allowUploads && (
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
                  <FiUpload size={18} />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}

              <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => shareState.setViewMode('grid')}
                  className={`p-2 rounded ${shareState.viewMode === 'grid' ? 'bg-indigo-600' : 'text-gray-400 hover:text-white'}`}
                >
                  <FiGrid size={18} />
                </button>
                <button
                  onClick={() => shareState.setViewMode('list')}
                  className={`p-2 rounded ${shareState.viewMode === 'list' ? 'bg-indigo-600' : 'text-gray-400 hover:text-white'}`}
                >
                  <FiList size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* File input */}
        <input type="file" ref={fileInputRef} className="hidden" multiple onChange={operations.handleUploadFromInput} />

        {/* Main content area */}
        <div className="flex-1 overflow-hidden p-4">
          {(shareState.sortedFilteredFiles || []).length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>This folder is empty</p>
            </div>
          ) : (
            <Suspense fallback={<div className="text-center text-gray-400">Loading...</div>}>
              <div className="h-full">
                {shareState.viewMode === 'grid' ? (
                  <ShareGrid
                    files={shareState.sortedFilteredFiles || []}
                    token={token}
                    submittedPassword={submittedPassword}
                    currentSubPath={shareState.currentSubPath}
                    allowUploads={shareResponse.allowUploads}
                    deletingFile={shareState.deletingFile}
                    renamingFile={shareState.renamingFile}
                    newFileName={shareState.newFileName}
                    onNewFileNameChange={shareState.setNewFileName}
                    onCancelRename={operations.cancelRename}
                    onConfirmRename={() => operations.confirmRename(shareState.renamingFile, shareState.newFileName)}
                    onCancelDelete={operations.cancelDelete}
                    onConfirmDelete={() => operations.confirmDelete(shareState.deletingFile)}
                    processingFile={shareState.processingFile}
                    onFileClick={(file) => {
                      if (file.isDirectory) {
                        operations.navigateToSubFolder(file.name);
                      } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPdf(file.name) || is3dFile(file.name) || isXlsx(file.name)) {
                        operations.openMediaViewer(file);
                      }
                    }}
                    onContextMenu={operations.handleContextMenu}
                    onDownload={operations.handleDownload}
                    onInitiateRename={operations.initiateRename}
                    onInitiateDelete={operations.initiateDelete}
                    onOpenMediaViewer={operations.openMediaViewer}
                    formatFileSize={operations.formatFileSize}
                  />
                ) : (
                  <ShareList
                    files={shareState.sortedFilteredFiles || []}
                    allowUploads={shareResponse.allowUploads}
                    deletingFile={shareState.deletingFile}
                    renamingFile={shareState.renamingFile}
                    newFileName={shareState.newFileName}
                    setNewFileName={shareState.setNewFileName}
                    cancelDelete={operations.cancelDelete}
                    confirmDelete={() => operations.confirmDelete(shareState.deletingFile)}
                    cancelRename={operations.cancelRename}
                    confirmRename={() => operations.confirmRename(shareState.renamingFile, shareState.newFileName)}
                    processingFile={shareState.processingFile}
                    onFileClick={(file) => {
                      if (file.isDirectory) {
                        operations.navigateToSubFolder(file.name);
                      } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPdf(file.name) || is3dFile(file.name) || isXlsx(file.name)) {
                        operations.openMediaViewer(file);
                      }
                    }}
                    onDownload={operations.handleDownload}
                    onContextMenu={operations.handleContextMenu}
                    onInitiateRename={operations.initiateRename}
                    onInitiateDelete={operations.initiateDelete}
                    onOpenMediaViewer={operations.openMediaViewer}
                    formatFileSize={operations.formatFileSize}
                  />
                )}
              </div>
            </Suspense>
          )}
        </div>

        {/* Media Viewer Modal */}
        {shareState.viewerFile && (
          <Suspense fallback={null}>
            <MediaViewer
              viewerFile={shareState.viewerFile}
              viewableFiles={shareState.viewableFiles}
              currentPath={shareState.currentSubPath}
              shareToken={token}
              sharePassword={submittedPassword}
              onClose={operations.closeMediaViewer}
              onNavigate={operations.navigateViewer}
              onSelectFile={operations.selectViewerFile}
            />
          </Suspense>
        )}

        {/* Context Menu */}
        {shareState.contextMenu && (
          <Suspense fallback={null}>
            <ContextMenu
              contextMenu={shareState.contextMenu}
              file={shareState.selectedContextFile}
              onClose={operations.closeContextMenu}
              onNavigateToFolder={() => {
                if (shareState.selectedContextFile?.isDirectory) {
                  operations.navigateToSubFolder(shareState.selectedContextFile.name);
                }
                operations.closeContextMenu();
              }}
              onDownload={() => {
                if (shareState.selectedContextFile) {
                  operations.handleDownload(shareState.selectedContextFile);
                }
                operations.closeContextMenu();
              }}
              onView={() => {
                if (shareState.selectedContextFile) {
                  operations.openMediaViewer(shareState.selectedContextFile);
                }
                operations.closeContextMenu();
              }}
              onRename={
                shareResponse.allowUploads
                  ? () => {
                      if (shareState.selectedContextFile) {
                        operations.initiateRename(shareState.selectedContextFile);
                      }
                      operations.closeContextMenu();
                    }
                  : undefined
              }
              onDelete={
                shareResponse.allowUploads
                  ? () => {
                      if (shareState.selectedContextFile) {
                        operations.initiateDelete(shareState.selectedContextFile);
                      }
                      operations.closeContextMenu();
                    }
                  : undefined
              }
            />
          </Suspense>
        )}

        {/* Upload Progress */}
        {shareState.uploadingFiles.length > 0 && (
          <div className="absolute bottom-6 right-6 bg-gray-800 rounded-lg shadow-lg p-6 w-80 border border-gray-700 z-40">
            <h3 className="font-semibold mb-4">Uploading ({shareState.uploadingFiles.length})</h3>
            <div className="space-y-2 max-h-48 overflow-auto">
              {shareState.uploadingFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-2 text-sm">
                  {file.status === 'uploading' && <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full"></div>}
                  {file.status === 'success' && <div className="text-green-400">✓</div>}
                  {file.status === 'error' && <div className="text-red-400">✗</div>}
                  <span className="truncate text-gray-300">{file.fileName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
