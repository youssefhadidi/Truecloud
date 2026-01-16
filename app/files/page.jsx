/** @format */

'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, Suspense, lazy, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFiles, useCreateFolder, useUploadFile, useDeleteFile, useRenameFile } from '@/lib/api/files';
import {
  FiUpload,
  FiLogOut,
  FiUser,
  FiFolder,
  FiFile,
  FiImage,
  FiVideo,
  FiDownload,
  FiTrash2,
  FiGrid,
  FiList,
  FiRefreshCw,
  FiArrowLeft,
  FiPlus,
  FiHome,
  FiChevronRight,
  FiEdit,
  FiBox,
} from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import UploadStatus from '@/components/files/UploadStatus';
import ContextMenu from '@/components/files/ContextMenu';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf } from '@/lib/clientFileUtils';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));

export default function FilesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState(['']);
  const [viewMode, setViewMode] = useState('grid'); // 'list' or 'grid'
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedContextFile, setSelectedContextFile] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const [renamingFile, setRenamingFile] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  const [processingFile, setProcessingFile] = useState(null); // Track file being processed
  const [viewerFile, setViewerFile] = useState(null); // File being viewed in media viewer
  const [uploads, setUploads] = useState([]); // Track upload progress

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Fetch files using custom hook
  const { data: filesData, isLoading: loading } = useFiles(currentPath, status === 'authenticated');
  const files = filesData || [];

  // Memoize viewable files calculation
  const viewableFiles = useMemo(() => {
    return files.filter((f) => !f.isDirectory && (isImage(f.name) || isVideo(f.name) || isAudio(f.name) || is3dFile(f.name) || isPdf(f.name)));
  }, [files]);

  const navigateToFolder = (folderName) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    setCurrentPath(newPath);
    setPathHistory([...pathHistory, newPath]);
  };

  const goBack = () => {
    if (pathHistory.length > 1) {
      const newHistory = pathHistory.slice(0, -1);
      setPathHistory(newHistory);
      setCurrentPath(newHistory[newHistory.length - 1]);
    }
  };

  const navigateToBreadcrumb = (index) => {
    const newHistory = pathHistory.slice(0, index + 1);
    setPathHistory(newHistory);
    setCurrentPath(newHistory[newHistory.length - 1]);
  };

  // Create folder mutation
  const createFolderMutation = useCreateFolder(currentPath);

  const initiateCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName('New Folder');
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
    setErrorMessage(null);
  };

  const confirmCreateFolder = () => {
    if (!newFolderName.trim()) {
      cancelCreateFolder();
      return;
    }
    createFolderMutation.mutate(newFolderName, {
      onSuccess: () => {
        setCreatingFolder(false);
        setNewFolderName('');
        setErrorMessage(null);
      },
      onError: (error) => {
        console.error('Create folder error:', error);
        setErrorMessage('Failed to create folder');
        setCreatingFolder(false);
      },
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      await uploadFile(file);
    }
  };

  // Upload mutation
  const uploadMutation = useUploadFile(currentPath, (uploadId, progress) => {
    setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, progress } : u)));
  });

  const uploadFile = async (file) => {
    const uploadId = Date.now() + Math.random();

    setUploads((prev) => [
      ...prev,
      {
        id: uploadId,
        fileName: file.name,
        progress: 0,
        status: 'uploading',
      },
    ]);

    setUploading(true);
    setErrorMessage(null);
    uploadMutation.mutate(
      { file, uploadId },
      {
        onSuccess: () => {
          setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'success', progress: 100 } : u)));
          setTimeout(() => {
            setUploads((prev) => prev.filter((u) => u.id !== uploadId));
          }, 3000);
          setUploading(false);
        },
        onError: (error) => {
          console.error('Upload error:', error);
          setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'error', error: error.message } : u)));
          setErrorMessage(`Upload failed for ${file.name}`);
          setUploading(false);
        },
      }
    );
  };

  const handleContextMenu = (e, file) => {
    e.preventDefault();
    setSelectedContextFile(file);
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    setSelectedContextFile(null);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const initiateDelete = (file) => {
    setDeletingFile(file);
    closeContextMenu();
  };

  const cancelDelete = () => {
    setDeletingFile(null);
  };

  // Delete mutation
  const deleteMutation = useDeleteFile(currentPath);

  const confirmDelete = () => {
    if (!deletingFile) return;
    setProcessingFile(deletingFile.id);
    deleteMutation.mutate(deletingFile.id, {
      onSuccess: () => {
        setDeletingFile(null);
        setErrorMessage(null);
        setProcessingFile(null);
      },
      onError: (error) => {
        console.error('Delete error:', error);
        setErrorMessage('Delete failed');
        setDeletingFile(null);
        setProcessingFile(null);
      },
    });
  };

  const initiateRename = (file) => {
    setRenamingFile(file);
    setNewFileName(file.name);
    closeContextMenu();
  };

  const cancelRename = () => {
    setRenamingFile(null);
    setNewFileName('');
  };

  // Rename mutation
  const renameMutation = useRenameFile(currentPath);

  const confirmRename = () => {
    if (!renamingFile || !newFileName.trim() || newFileName === renamingFile.name) {
      cancelRename();
      return;
    }
    setProcessingFile(renamingFile.id);
    renameMutation.mutate(
      { fileId: renamingFile.id, newName: newFileName },
      {
        onSuccess: () => {
          setRenamingFile(null);
          setNewFileName('');
          setErrorMessage(null);
          setProcessingFile(null);
        },
        onError: (error) => {
          console.error('Rename error:', error);
          setErrorMessage('Rename failed');
          setRenamingFile(null);
          setProcessingFile(null);
        },
      }
    );
  };

  const handleDownload = (fileId, fileName) => {
    window.open(`/api/files/download/${encodeURIComponent(fileId)}?path=${encodeURIComponent(currentPath)}`, '_blank');
  };

  const getFileIcon = (file) => {
    if (file.isDirectory) return <FiFolder className="text-blue-500" size={24} />;
    if (is3dFile(file.name)) return <FiBox className="text-orange-500" size={24} />;
    if (isImage(file.name)) return <FiImage className="text-green-500" size={24} />;
    if (isVideo(file.name)) return <FiVideo className="text-purple-500" size={24} />;
    return <FiFile className="text-gray-500" size={24} />;
  };

  const openMediaViewer = (file) => {
    setViewerFile(file);
  };

  const closeMediaViewer = () => {
    setViewerFile(null);
  };

  const navigateViewer = (direction) => {
    if (!viewerFile || viewableFiles.length === 0) return;

    const currentIndex = viewableFiles.findIndex((f) => f.id === viewerFile.id);
    let newIndex;

    if (direction === 'next') {
      newIndex = (currentIndex + 1) % viewableFiles.length;
    } else {
      newIndex = (currentIndex - 1 + viewableFiles.length) % viewableFiles.length;
    }

    setViewerFile(viewableFiles[newIndex]);
  };

  // Keyboard navigation for media viewer
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!viewerFile) return;

      if (e.key === 'ArrowRight') {
        navigateViewer('next');
      } else if (e.key === 'ArrowLeft') {
        navigateViewer('prev');
      } else if (e.key === 'Escape') {
        closeMediaViewer();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [viewerFile, viewableFiles]);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
    return Math.round((Number(bytes) / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden" onClick={closeContextMenu}>
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">truecloud</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <FiUser />
                <span className="text-sm">{session?.user?.email}</span>
              </div>
              <button onClick={() => signOut({ callbackUrl: '/auth/login' })} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                <FiLogOut />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="flex-1 overflow-y-auto max-w-[1280px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex flex-col relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag and Drop Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-40 bg-indigo-500 bg-opacity-10 border-4 border-dashed border-indigo-500 rounded-lg flex items-center justify-center pointer-events-none">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-2xl">
              <div className="text-center">
                <FiUpload className="mx-auto text-indigo-600 dark:text-indigo-400 mb-4" size={64} />
                <p className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Drop files here</p>
                <p className="text-gray-600 dark:text-gray-400">Release to upload to current folder</p>
              </div>
            </div>
          </div>
        )}
        {/* Breadcrumb Navigation */}
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <button onClick={() => navigateToBreadcrumb(0)} className="flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400">
            <FiHome size={16} />
            <span>Home</span>
          </button>
          {currentPath &&
            currentPath.split('/').map((folder, index, arr) => (
              <div key={index} className="flex items-center gap-2">
                <FiChevronRight size={14} />
                <button
                  onClick={() => navigateToBreadcrumb(index + 1)}
                  className={`hover:text-indigo-600 dark:hover:text-indigo-400 ${index === arr.length - 1 ? 'font-medium text-gray-900 dark:text-white' : ''}`}
                >
                  {folder}
                </button>
              </div>
            ))}
        </div>

        {/* Toolbar Navbar */}
        <div className="mb-6 flex justify-between items-center gap-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex gap-2 flex-wrap">
            <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer">
              <FiUpload />
              {uploading ? 'Uploading...' : 'Upload File'}
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>

            <button onClick={initiateCreateFolder} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700" disabled={creatingFolder}>
              <FiPlus />
              New Folder
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={goBack}
              disabled={pathHistory.length <= 1}
              className={`p-2 rounded-lg ${
                pathHistory.length <= 1 ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="Go Back"
            >
              <FiArrowLeft size={20} />
            </button>

            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['files', currentPath] })}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              title="Refresh"
            >
              <FiRefreshCw size={20} />
            </button>

            {/* View Toggle */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400'}`}
                title="List View"
              >
                <FiList size={20} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400'}`}
                title="Grid View"
              >
                <FiGrid size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* File Grid */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-auto flex-grow-1">
          {viewMode === 'list' ? (
            /* List View */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Modified</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {creatingFolder && (
                    <tr className="bg-blue-50 dark:bg-blue-900/20">
                      <td colSpan="4" className="px-6 py-4">
                        <div className="flex items-center gap-3 border border-blue-200 dark:border-blue-800 rounded px-4 py-2">
                          <FiFolder className="text-blue-500" size={24} />
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') confirmCreateFolder();
                              if (e.key === 'Escape') cancelCreateFolder();
                            }}
                            onBlur={confirmCreateFolder}
                            className="flex-1 px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            autoFocus
                            onFocus={(e) => e.target.select()}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={cancelCreateFolder}
                              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                            <button onClick={confirmCreateFolder} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                              Create
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {files.length === 0 && !creatingFolder ? (
                    <tr>
                      <td colSpan="4" className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                        No files yet. Upload your first file!
                      </td>
                    </tr>
                  ) : (
                    files.map((file) => (
                      <tr key={file.id} className="hover:bg-gray-50 dark:hover:bg-gray-700" onContextMenu={(e) => handleContextMenu(e, file)}>
                        {deletingFile?.id === file.id ? (
                          // Delete confirmation row
                          <td colSpan="4" className="px-6 py-4">
                            <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-4 py-2">
                              <span className="text-red-800 dark:text-red-200 font-medium">
                                Delete {file.isDirectory ? 'folder' : 'file'} "{file.name}"?
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={cancelDelete}
                                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                                >
                                  Cancel
                                </button>
                                <button onClick={confirmDelete} className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                                  Delete
                                </button>
                              </div>
                            </div>
                          </td>
                        ) : renamingFile?.id === file.id ? (
                          // Rename row
                          <td colSpan="4" className="px-6 py-4">
                            <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-4 py-2">
                              {getFileIcon(file)}
                              <input
                                type="text"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') confirmRename();
                                  if (e.key === 'Escape') cancelRename();
                                }}
                                className="flex-1 px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={cancelRename}
                                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                                >
                                  Cancel
                                </button>
                                <button onClick={confirmRename} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                                  Rename
                                </button>
                              </div>
                            </div>
                          </td>
                        ) : (
                          // Normal row
                          <>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                {processingFile === file.id ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div> : getFileIcon(file)}
                                {file.isDirectory ? (
                                  <button
                                    onClick={() => navigateToFolder(file.name)}
                                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                    disabled={processingFile === file.id}
                                  >
                                    {file.name}
                                  </button>
                                ) : (
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{new Date(file.updatedAt).toLocaleDateString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex justify-end gap-2">
                                {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)) && (
                                  <button
                                    onClick={() => openMediaViewer(file)}
                                    className="text-purple-600 hover:text-purple-900 dark:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="View"
                                    disabled={processingFile === file.id}
                                  >
                                    {is3dFile(file.name) ? (
                                      <FiBox size={18} />
                                    ) : isVideo(file.name) ? (
                                      <FiVideo size={18} />
                                    ) : isImage(file.name) ? (
                                      <FiImage size={18} />
                                    ) : isAudio(file.name) ? (
                                      <FiVideo size={18} />
                                    ) : isPdf(file.name) ? (
                                      <FiFile size={18} />
                                    ) : null}
                                  </button>
                                )}
                                <button
                                  onClick={() => initiateRename(file)}
                                  className="text-blue-600 hover:text-blue-900 dark:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Rename"
                                  disabled={processingFile === file.id}
                                >
                                  <FiEdit size={18} />
                                </button>
                                <button
                                  onClick={() => handleDownload(file.id, file.name)}
                                  className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Download"
                                  disabled={processingFile === file.id}
                                >
                                  <FiDownload size={18} />
                                </button>
                                <button
                                  onClick={() => initiateDelete(file)}
                                  className="text-red-600 hover:text-red-900 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Delete"
                                  disabled={processingFile === file.id}
                                >
                                  <FiTrash2 size={18} />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Grid View */
            <div className="p-6">
              {files.length === 0 && !creatingFolder ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">No files yet. Upload your first file!</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {creatingFolder && (
                    <div className="group relative bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 border-2 border-blue-300 dark:border-blue-700">
                      <div className="aspect-square flex items-center justify-center mb-3 bg-white dark:bg-gray-600 rounded-lg">
                        <FiFolder className="text-blue-500" size={48} />
                      </div>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') confirmCreateFolder();
                          if (e.key === 'Escape') cancelCreateFolder();
                        }}
                        className="w-full px-2 py-1 text-sm mb-2 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        autoFocus
                        onFocus={(e) => e.target.select()}
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={cancelCreateFolder}
                          className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                        <button onClick={confirmCreateFolder} className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                          Create
                        </button>
                      </div>
                    </div>
                  )}
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="group relative bg-gray-50 dark:bg-gray-700 rounded-lg p-2 hover:shadow-lg transition-shadow cursor-pointer"
                      onClick={() => file.isDirectory && deletingFile?.id !== file.id && navigateToFolder(file.name)}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                    >
                      {deletingFile?.id === file.id ? (
                        // Delete confirmation overlay
                        <div className="absolute inset-0 bg-red-50 dark:bg-red-900/90 rounded-lg p-4 flex flex-col items-center justify-center gap-3 z-10">
                          <p className="text-red-800 dark:text-red-200 font-medium text-center text-sm">Delete {file.isDirectory ? 'folder' : 'file'}?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelDelete();
                              }}
                              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete();
                              }}
                              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : renamingFile?.id === file.id ? (
                        // Rename overlay
                        <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/90 rounded-lg p-4 flex flex-col items-center justify-center gap-3 z-10">
                          <input
                            type="text"
                            value={newFileName}
                            onChange={(e) => setNewFileName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') confirmRename();
                              if (e.key === 'Escape') cancelRename();
                            }}
                            className="w-full px-2 py-1 border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRename();
                              }}
                              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmRename();
                              }}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Rename
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {/* File Icon/Preview */}
                      <div
                        className={`aspect-square flex items-center justify-center mb-3 bg-white dark:bg-gray-600 rounded-lg relative ${
                          isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)
                            ? 'cursor-pointer hover:opacity-90 transition-opacity'
                            : ''
                        }`}
                        onClick={() => {
                          if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)) {
                            openMediaViewer(file);
                          }
                        }}
                      >
                        {processingFile === file.id && (
                          <div className="absolute inset-0 bg-white dark:bg-gray-600 bg-opacity-75 dark:bg-opacity-75 rounded-lg flex items-center justify-center z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                          </div>
                        )}
                        {isImage(file.name) && (
                          <LazyImage
                            src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                            alt={file.name}
                            className="w-full h-full object-cover rounded-lg"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        )}
                        {isVideo(file.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={file.name}
                              className="w-full h-full object-cover rounded-lg"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black bg-opacity-60 rounded-full p-3">
                                <FiVideo className="text-white" size={24} />
                              </div>
                            </div>
                            <div className="hidden flex items-center justify-center w-full h-full">{getFileIcon(file)}</div>
                          </div>
                        )}
                        {isPdf(file.name) && (
                          <div className="relative w-full h-full">
                            <LazyImage
                              src={`/api/files/thumbnail/${file.id}?path=${encodeURIComponent(currentPath)}`}
                              alt={file.name}
                              className="w-full h-full object-cover rounded-lg"
                              onError={(e) => {
                                if (e?.target) {
                                  e.target.style.display = 'none';
                                  if (e.target.nextSibling) {
                                    e.target.nextSibling.style.display = 'flex';
                                  }
                                }
                              }}
                            />
                            <div className="hidden flex items-center justify-center w-full h-full">{getFileIcon(file)}</div>
                          </div>
                        )}
                        <div
                          className={`${
                            !is3dFile(file.name) && (isImage(file.name) || isVideo(file.name) || isPdf(file.name)) ? 'hidden' : 'flex'
                          } items-center justify-center w-full h-full`}
                        >
                          {getFileIcon(file)}
                        </div>
                      </div>

                      {/* File Name */}
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={file.name}>
                        {file.name}
                      </div>

                      {/* File Size */}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatFileSize(file.size)}</div>

                      {/* Actions (shown on hover) */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1">
                        {(isVideo(file.name) || isImage(file.name) || isAudio(file.name) || is3dFile(file.name) || isPdf(file.name)) && (
                          <button
                            onClick={() => openMediaViewer(file)}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="View Media"
                            disabled={processingFile === file.id}
                          >
                            {is3dFile(file.name) ? (
                              <FiBox size={16} className="text-orange-600 dark:text-orange-400" />
                            ) : isVideo(file.name) ? (
                              <FiVideo size={16} className="text-purple-600 dark:text-purple-400" />
                            ) : isImage(file.name) ? (
                              <FiImage size={16} className="text-green-600 dark:text-green-400" />
                            ) : isAudio(file.name) ? (
                              <FiVideo size={16} className="text-blue-600 dark:text-blue-400" />
                            ) : isPdf(file.name) ? (
                              <FiFile size={16} className="text-red-600 dark:text-red-400" />
                            ) : null}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            initiateRename(file);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Rename"
                          disabled={processingFile === file.id}
                        >
                          <FiEdit size={16} />
                        </button>
                        <button
                          onClick={() => handleDownload(file.id, file.name)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Download"
                          disabled={processingFile === file.id}
                        >
                          <FiDownload size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            initiateDelete(file);
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                          disabled={processingFile === file.id}
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Context Menu */}
      <ContextMenu
        contextMenu={contextMenu}
        file={selectedContextFile}
        onNavigateToFolder={() => {
          navigateToFolder(selectedContextFile.name);
          closeContextMenu();
        }}
        onRename={() => {
          initiateRename(selectedContextFile);
        }}
        onDownload={() => {
          handleDownload(selectedContextFile.id, selectedContextFile.name);
          closeContextMenu();
        }}
        onView={() => {
          openMediaViewer(selectedContextFile);
          closeContextMenu();
        }}
        onDelete={() => {
          initiateDelete(selectedContextFile);
          closeContextMenu();
        }}
        onClose={closeContextMenu}
      />

      {/* Media Viewer Modal */}
      <Suspense fallback={null}>
        <MediaViewer viewerFile={viewerFile} viewableFiles={viewableFiles} currentPath={currentPath} onClose={closeMediaViewer} onNavigate={navigateViewer} />
      </Suspense>

      {/* Upload Status */}
      <UploadStatus uploads={uploads} />
    </div>
  );
}
