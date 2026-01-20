/** @format */

'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, Suspense, lazy, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFiles, useCreateFolder, useUploadFile, useDeleteFile, useRenameFile } from '@/lib/api/files';
import { FiUpload, FiLogOut, FiUser, FiFolder, FiFile, FiImage, FiVideo, FiRefreshCw, FiArrowLeft, FiPlus, FiHome, FiChevronRight, FiGrid, FiList, FiBox } from 'react-icons/fi';
import UploadStatus from '@/components/files/UploadStatus';
import ContextMenu from '@/components/files/ContextMenu';
import { is3dFile } from '@/components/files/Viewer3D';
import { isImage, isVideo, isAudio, isPdf } from '@/lib/clientFileUtils';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const GridView = lazy(() => import('@/components/files/GridView'));
const ListView = lazy(() => import('@/components/files/ListView'));

export default function FilesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
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
  const [folderDisplayNames, setFolderDisplayNames] = useState({}); // Store display names for user folders

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Fetch files using custom hook
  const { data: filesData, isLoading: loading } = useFiles(currentPath, status === 'authenticated');
  const files = useMemo(() => {
    // Filter out hidden folders/files (starting with ".")
    return (filesData || []).filter((f) => !f.name.startsWith('.'));
  }, [filesData]);

  // Store display names for user folders when files are loaded
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
      },
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
      },
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

  const getFolderDisplayName = (folderName) => {
    // Check if it's a user private folder and we have the display name cached
    if (folderName.startsWith('user_')) {
      return folderDisplayNames[folderName] || folderName;
    }
    return folderName;
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

  if (status === 'loading') {
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
              {session?.user?.role === 'admin' && (
                <button onClick={() => router.push('/admin')} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                  <FiUser />
                  Admin Panel
                </button>
              )}
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
        className="flex-1 overflow-y-auto max-w-[1400px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex flex-col relative"
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
            currentPath.split('/').map((folder, index, arr) => {
              const displayName = folder.startsWith('user_') ? getFolderDisplayName(folder) : folder;
              return (
                <div key={index} className="flex items-center gap-2">
                  <FiChevronRight size={14} />
                  <button
                    onClick={() => navigateToBreadcrumb(index + 1)}
                    className={`hover:text-indigo-600 dark:hover:text-indigo-400 ${index === arr.length - 1 ? 'font-medium text-gray-900 dark:text-white' : ''}`}
                  >
                    {displayName}
                  </button>
                </div>
              );
            })}
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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex-grow-1 flex flex-col">
          {viewMode === 'list' ? (
            /* List View with Virtual Scrolling */
            <div className="overflow-hidden flex-grow flex flex-col">
              {creatingFolder && (
                <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
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
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center flex-grow">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading files...</p>
                  </div>
                </div>
              ) : files.length === 0 && !creatingFolder ? (
                <div className="flex items-center justify-center flex-grow text-gray-500 dark:text-gray-400">No files yet. Upload your first file!</div>
              ) : (
                <div className="flex flex-col flex-grow overflow-hidden">
                  <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-[1fr_150px_150px_200px] gap-4 px-6 py-3">
                      <div className="text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</div>
                      <div className="text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Size</div>
                      <div className="text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Modified</div>
                      <div className="text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</div>
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
                      files={files}
                      deletingFile={deletingFile}
                      renamingFile={renamingFile}
                      newFileName={newFileName}
                      setNewFileName={setNewFileName}
                      cancelDelete={cancelDelete}
                      confirmDelete={confirmDelete}
                      cancelRename={cancelRename}
                      confirmRename={confirmRename}
                      processingFile={processingFile}
                      handleContextMenu={handleContextMenu}
                      getFileIcon={getFileIcon}
                      navigateToFolder={navigateToFolder}
                      formatFileSize={formatFileSize}
                      openMediaViewer={openMediaViewer}
                      initiateRename={initiateRename}
                      handleDownload={handleDownload}
                      initiateDelete={initiateDelete}
                    />{' '}
                  </Suspense>{' '}
                </div>
              )}
            </div>
          ) : (
            /* Grid View with Virtual Scrolling */
            <div className="p-4 flex flex-col flex-grow">
              {loading ? (
                <div className="flex items-center justify-center flex-grow">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading files...</p>
                  </div>
                </div>
              ) : files.length === 0 && !creatingFolder ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">No files yet. Upload your first file!</div>
              ) : (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center flex-grow">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                  }
                >
                  <GridView
                    files={files}
                    creatingFolder={creatingFolder}
                    newFolderName={newFolderName}
                    onNewFolderNameChange={setNewFolderName}
                    onCancelCreateFolder={cancelCreateFolder}
                    onConfirmCreateFolder={confirmCreateFolder}
                    deletingFile={deletingFile}
                    renamingFile={renamingFile}
                    newFileName={newFileName}
                    onNewFileNameChange={setNewFileName}
                    onCancelRename={cancelRename}
                    onConfirmRename={confirmRename}
                    processingFile={processingFile}
                    currentPath={currentPath}
                    onNavigateToFolder={navigateToFolder}
                    onOpenMediaViewer={openMediaViewer}
                    onInitiateRename={initiateRename}
                    onHandleDownload={handleDownload}
                    onInitiateDelete={initiateDelete}
                    onConfirmDelete={confirmDelete}
                    onCancelDelete={cancelDelete}
                  />{' '}
                </Suspense>
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
