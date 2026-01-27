/** @format */

'use client';

import { useState, useEffect, use, lazy, Suspense, useRef, useCallback } from 'react';
import { FiDownload, FiLock, FiFile, FiFolder, FiImage, FiVideo, FiBox, FiFileText, FiEye, FiChevronRight, FiArrowLeft, FiGrid, FiList, FiPlay, FiUpload, FiX } from 'react-icons/fi';
import { isImage, isVideo, isAudio, isPdf, isXlsx } from '@/lib/clientFileUtils';
import { is3dFile } from '@/components/files/Viewer3D';

// Lazy load heavy viewer components
const Viewer3D = lazy(() => import('@/components/files/Viewer3D'));
const SkpViewer = lazy(() => import('@/components/files/SkpViewer'));
const XlsxViewer = lazy(() => import('@/components/files/XlsxViewer'));

// Check if file is SKP
const isSkp = (fileName) => fileName?.toLowerCase().endsWith('.skp');

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function SharePage({ params }) {
  const { token } = use(params);
  const [shareData, setShareData] = useState(null);
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifiedPassword, setVerifiedPassword] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);
  const [directoryFiles, setDirectoryFiles] = useState(null);
  const [currentSubPath, setCurrentSubPath] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchShareData();
  }, [token]);

  const fetchShareData = async (pwd = null) => {
    setLoading(true);
    setError(null);

    const headers = pwd ? { 'x-share-password': pwd } : {};

    try {
      const res = await fetch(`/api/public/${token}`, { headers });
      const data = await res.json();

      if (data.requiresPassword) {
        setRequiresPassword(true);
        setShareData({ fileName: data.fileName, isDirectory: data.isDirectory });
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Share not found');
        setLoading(false);
        return;
      }

      setShareData(data);
      setRequiresPassword(false);
      setVerifiedPassword(pwd);

      // If it's a directory, fetch the file listing
      if (data.isDirectory) {
        await fetchDirectoryFiles(pwd);
      }

      setLoading(false);
    } catch (e) {
      setError('Failed to load share');
      setLoading(false);
    }
  };

  const fetchDirectoryFiles = async (pwd = null, subPath = '') => {
    const headers = pwd || verifiedPassword ? { 'x-share-password': pwd || verifiedPassword } : {};
    const url = `/api/public/${token}/files${subPath ? `?path=${encodeURIComponent(subPath)}` : ''}`;

    try {
      const res = await fetch(url, { headers });
      const data = await res.json();

      if (res.ok) {
        setDirectoryFiles(data.files);
        setCurrentSubPath(subPath);
      }
    } catch (e) {
      console.error('Failed to fetch directory files:', e);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    fetchShareData(password);
  };

  const handleDownload = async () => {
    const headers = verifiedPassword ? { 'x-share-password': verifiedPassword } : {};
    const downloadUrl = `/api/public/${token}/download`;

    try {
      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let fileName = shareData.fileName;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (match) fileName = match[1];
      } else if (shareData.isDirectory) {
        // Fallback: add .zip extension for directories
        fileName = `${shareData.fileName}.zip`;
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download file');
    }
  };

  const navigateToSubFolder = (folderName) => {
    const newPath = currentSubPath ? `${currentSubPath}/${folderName}` : folderName;
    fetchDirectoryFiles(verifiedPassword, newPath);
  };

  const navigateUp = () => {
    const parts = currentSubPath.split('/');
    parts.pop();
    const newPath = parts.join('/');
    fetchDirectoryFiles(verifiedPassword, newPath);
  };

  const getFileIcon = (file) => {
    if (file.isDirectory) return <FiFolder className="text-blue-500" size={24} />;
    if (isImage(file.name)) return <FiImage className="text-green-500" size={24} />;
    if (isVideo(file.name)) return <FiVideo className="text-purple-500" size={24} />;
    if (is3dFile(file.name)) return <FiBox className="text-orange-500" size={24} />;
    if (isPdf(file.name)) return <FiFileText className="text-red-500" size={24} />;
    return <FiFile className="text-gray-500" size={24} />;
  };

  const canPreview = (file) => {
    return isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPdf(file.name) || is3dFile(file.name) || isXlsx(file.name);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center max-w-md mx-auto">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <FiFile className="text-red-500" size={32} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Share Not Found</h2>
        <p className="text-gray-500 dark:text-gray-400">{error}</p>
      </div>
    );
  }

  // Password entry form
  if (requiresPassword && !verifiedPassword) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <FiLock className="text-indigo-500" size={32} />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Password Protected</h2>
          <p className="text-gray-500 dark:text-gray-400">
            This {shareData?.isDirectory ? 'folder' : 'file'} is password protected.
          </p>
          {shareData?.fileName && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 font-medium">{shareData.fileName}</p>}
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Enter password"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  // File viewer modal
  if (viewingFile) {
    const filePath = currentSubPath ? `${currentSubPath}/${viewingFile.name}` : viewingFile.name;
    const pwdParam = verifiedPassword ? `&pwd=${encodeURIComponent(verifiedPassword)}` : '';

    const getFileUrl = () => {
      if (isImage(viewingFile.name)) {
        return `/api/public/${token}/optimize-image?file=${encodeURIComponent(filePath)}&quality=85&w=2000&h=2000${pwdParam}`;
      }
      if (isVideo(viewingFile.name) || isAudio(viewingFile.name) || isPdf(viewingFile.name)) {
        return `/api/public/${token}/stream?file=${encodeURIComponent(filePath)}${pwdParam}`;
      }
      return `/api/public/${token}/download?path=${encodeURIComponent(filePath)}${pwdParam}`;
    };

    return (
      <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4" onClick={() => setViewingFile(null)}>
        <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-5xl h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
            <h3 className="text-lg font-semibold text-white">{viewingFile.name}</h3>
            <button onClick={() => setViewingFile(null)} className="text-gray-400 hover:text-white px-3 py-2">
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            {isImage(viewingFile.name) && (
              <img src={getFileUrl()} alt={viewingFile.name} className="max-w-full max-h-full object-contain" />
            )}
            {isVideo(viewingFile.name) && (
              <video controls autoPlay className="max-w-full max-h-full" src={getFileUrl()}>
                Your browser does not support video playback.
              </video>
            )}
            {isAudio(viewingFile.name) && (
              <audio controls className="w-full" src={getFileUrl()}>
                Your browser does not support audio playback.
              </audio>
            )}
            {isPdf(viewingFile.name) && <iframe src={getFileUrl()} className="w-full h-full" title={viewingFile.name} />}
            {is3dFile(viewingFile.name) && !isSkp(viewingFile.name) && (
              <Suspense fallback={<div className="text-white">Loading 3D viewer...</div>}>
                <Viewer3D
                  fileName={viewingFile.name}
                  currentPath={currentSubPath}
                  shareToken={token}
                  sharePassword={verifiedPassword}
                />
              </Suspense>
            )}
            {isSkp(viewingFile.name) && (
              <Suspense fallback={<div className="text-white">Loading 3D viewer...</div>}>
                <SkpViewer
                  fileName={viewingFile.name}
                  currentPath={currentSubPath}
                  shareToken={token}
                  sharePassword={verifiedPassword}
                />
              </Suspense>
            )}
            {isXlsx(viewingFile.name) && (
              <Suspense fallback={<div className="text-white">Loading spreadsheet...</div>}>
                <XlsxViewer
                  fileName={viewingFile.name}
                  currentPath={currentSubPath}
                  shareToken={token}
                  sharePassword={verifiedPassword}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Helper to get thumbnail URL for images/videos in share
  const getThumbnailUrl = (file) => {
    const filePath = currentSubPath ? `${currentSubPath}/${file.name}` : file.name;
    const pwdParam = verifiedPassword ? `&pwd=${encodeURIComponent(verifiedPassword)}` : '';
    return `/api/public/${token}/optimize-image?file=${encodeURIComponent(filePath)}&quality=60&w=300&h=300${pwdParam}`;
  };

  // Helper to download a single file
  const handleFileDownload = async (file) => {
    const filePath = currentSubPath ? `${currentSubPath}/${file.name}` : file.name;
    const headers = verifiedPassword ? { 'x-share-password': verifiedPassword } : {};
    const downloadUrl = `/api/public/${token}/download?path=${encodeURIComponent(filePath)}`;
    try {
      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  // Upload file
  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', currentSubPath);

    const headers = {};
    if (verifiedPassword) {
      headers['x-share-password'] = verifiedPassword;
    }

    try {
      const response = await fetch(`/api/public/${token}/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      return { success: true };
    } catch (error) {
      console.error('Upload error:', error);
      return { success: false, error: error.message };
    }
  };

  // Handle file upload
  const handleUpload = async (files) => {
    if (!shareData?.allowUploads || !files.length) return;

    const fileList = Array.from(files);
    const uploadItems = fileList.map((file) => ({
      id: `${file.name}-${Date.now()}`,
      name: file.name,
      status: 'uploading',
    }));

    setUploadingFiles(uploadItems);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const result = await uploadFile(file);

      setUploadingFiles((prev) =>
        prev.map((item) =>
          item.id === uploadItems[i].id ? { ...item, status: result.success ? 'done' : 'error', error: result.error } : item
        )
      );
    }

    // Refresh file list after upload
    setTimeout(() => {
      fetchDirectoryFiles(verifiedPassword, currentSubPath);
      setUploadingFiles([]);
    }, 1500);
  };

  // Drag and drop handlers
  const handleDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (shareData?.allowUploads) {
        setIsDragging(true);
      }
    },
    [shareData?.allowUploads]
  );

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (!shareData?.allowUploads) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleUpload(files);
      }
    },
    [shareData?.allowUploads, currentSubPath, verifiedPassword]
  );

  // Directory view
  if (shareData.isDirectory && directoryFiles) {
    return (
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden max-w-6xl mx-auto relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && shareData.allowUploads && (
          <div className="absolute inset-0 bg-indigo-600/20 border-2 border-dashed border-indigo-500 rounded-lg z-50 flex items-center justify-center">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg text-center">
              <FiUpload className="text-indigo-600 mx-auto mb-2" size={48} />
              <p className="text-lg font-medium text-gray-900 dark:text-white">Drop files to upload</p>
            </div>
          </div>
        )}

        {/* Upload progress overlay */}
        {uploadingFiles.length > 0 && (
          <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg w-80">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Uploading files...</h3>
              <div className="space-y-2 max-h-48 overflow-auto">
                {uploadingFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 text-sm">
                    {file.status === 'uploading' && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>}
                    {file.status === 'done' && <div className="text-green-500">✓</div>}
                    {file.status === 'error' && <div className="text-red-500">✗</div>}
                    <span className="truncate text-gray-700 dark:text-gray-300">{file.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={(e) => {
            if (e.target.files) {
              handleUpload(e.target.files);
              e.target.value = '';
            }
          }}
        />

        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FiFolder className="text-blue-500" size={32} />
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{shareData.fileName}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Shared by {shareData.ownerUsername}
                  {currentSubPath && ` • ${currentSubPath}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Upload button */}
              {shareData.allowUploads && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  title="Upload files"
                >
                  <FiUpload size={18} />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}

              {/* View Toggle */}
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                  title="List View"
                >
                  <FiList size={18} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                  title="Grid View"
                >
                  <FiGrid size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Breadcrumb navigation */}
          {currentSubPath && (
            <div className="flex items-center gap-2 mt-3">
              <button onClick={navigateUp} className="text-indigo-600 hover:text-indigo-500 flex items-center gap-1 text-sm">
                <FiArrowLeft size={14} />
                Back
              </button>
            </div>
          )}
        </div>

        {/* Grid View */}
        {viewMode === 'grid' ? (
          <div className="p-4">
            {directoryFiles.length === 0 ? (
              <div className="py-8 text-center text-gray-500 dark:text-gray-400">This folder is empty</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {directoryFiles.map((file) => (
                  <div
                    key={file.id}
                    className="group relative bg-gray-100 dark:bg-gray-700 rounded-lg p-2 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors select-none"
                    style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                    onClick={() => {
                      if (file.isDirectory) {
                        navigateToSubFolder(file.name);
                      } else if (canPreview(file)) {
                        setViewingFile(file);
                      }
                    }}
                  >
                    {/* Thumbnail/Icon */}
                    <div className="aspect-square flex items-center justify-center bg-gray-200 dark:bg-gray-600 rounded-lg mb-2 overflow-hidden relative">
                      {isImage(file.name) ? (
                        <img
                          src={getThumbnailUrl(file)}
                          alt={file.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      {isImage(file.name) && (
                        <div className="hidden items-center justify-center w-full h-full">
                          <FiImage className="text-green-500" size={40} />
                        </div>
                      )}
                      {isVideo(file.name) && (
                        <div className="relative w-full h-full flex items-center justify-center">
                          <FiVideo className="text-purple-500" size={40} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/50 rounded-full p-2">
                              <FiPlay className="text-white" size={20} />
                            </div>
                          </div>
                        </div>
                      )}
                      {file.isDirectory && <FiFolder className="text-blue-500" size={40} />}
                      {is3dFile(file.name) && <FiBox className="text-orange-500" size={40} />}
                      {isPdf(file.name) && <FiFileText className="text-red-500" size={40} />}
                      {!file.isDirectory && !isImage(file.name) && !isVideo(file.name) && !is3dFile(file.name) && !isPdf(file.name) && (
                        <FiFile className="text-gray-500" size={40} />
                      )}
                    </div>

                    {/* File name */}
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={file.name}>
                      {file.name}
                    </p>
                    {!file.isDirectory && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
                    )}

                    {/* Action buttons on hover */}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canPreview(file) && !file.isDirectory && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingFile(file);
                          }}
                          className="p-1.5 bg-white dark:bg-gray-800 rounded shadow text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                          title="Preview"
                        >
                          <FiEye size={14} />
                        </button>
                      )}
                      {!file.isDirectory && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFileDownload(file);
                          }}
                          className="p-1.5 bg-white dark:bg-gray-800 rounded shadow text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                          title="Download"
                        >
                          <FiDownload size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {directoryFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer select-none"
                style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                onClick={() => {
                  if (file.isDirectory) {
                    navigateToSubFolder(file.name);
                  } else if (canPreview(file)) {
                    setViewingFile(file);
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  {getFileIcon(file)}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{file.name}</p>
                    {!file.isDirectory && <p className="text-sm text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {canPreview(file) && !file.isDirectory && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewingFile(file);
                      }}
                      className="p-2 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded"
                      title="Preview"
                    >
                      <FiEye size={18} />
                    </button>
                  )}
                  {!file.isDirectory && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileDownload(file);
                      }}
                      className="p-2 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 rounded"
                      title="Download"
                    >
                      <FiDownload size={18} />
                    </button>
                  )}
                  {file.isDirectory && <FiChevronRight className="text-gray-400" size={18} />}
                </div>
              </div>
            ))}

            {directoryFiles.length === 0 && (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">This folder is empty</div>
            )}
          </div>
        )}

        {/* Download all button */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <button
            onClick={handleDownload}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center gap-2"
          >
            <FiDownload size={18} />
            Download as ZIP
          </button>
        </div>
      </div>
    );
  }

  // Single file view
  const fileIcon = shareData.isDirectory ? (
    <FiFolder className="text-blue-500" size={48} />
  ) : isImage(shareData.fileName) ? (
    <FiImage className="text-green-500" size={48} />
  ) : isVideo(shareData.fileName) ? (
    <FiVideo className="text-purple-500" size={48} />
  ) : is3dFile(shareData.fileName) ? (
    <FiBox className="text-orange-500" size={48} />
  ) : isPdf(shareData.fileName) ? (
    <FiFileText className="text-red-500" size={48} />
  ) : (
    <FiFile className="text-gray-500" size={48} />
  );

  // Inline preview for single files
  const renderPreview = () => {
    const pwdParam = verifiedPassword ? `&pwd=${encodeURIComponent(verifiedPassword)}` : '';
    const pwdParamFirst = verifiedPassword ? `?pwd=${encodeURIComponent(verifiedPassword)}` : '';

    if (isImage(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <img
            src={`/api/public/${token}/optimize-image?quality=85&w=1200&h=1200${pwdParam}`}
            alt={shareData.fileName}
            className="max-w-full max-h-[500px] mx-auto object-contain"
          />
        </div>
      );
    }

    if (isVideo(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <video controls className="w-full max-h-[500px]" src={`/api/public/${token}/stream${pwdParamFirst}`}>
            Your browser does not support video playback.
          </video>
        </div>
      );
    }

    if (isAudio(shareData.fileName)) {
      return (
        <div className="mt-6">
          <audio controls className="w-full" src={`/api/public/${token}/stream${pwdParamFirst}`}>
            Your browser does not support audio playback.
          </audio>
        </div>
      );
    }

    if (isPdf(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <iframe src={`/api/public/${token}/stream${pwdParamFirst}`} className="w-full h-[500px]" title={shareData.fileName} />
        </div>
      );
    }

    if (is3dFile(shareData.fileName) && !isSkp(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[500px]">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading 3D viewer...</div>}>
            <Viewer3D
              fileName={shareData.fileName}
              currentPath=""
              shareToken={token}
              sharePassword={verifiedPassword}
            />
          </Suspense>
        </div>
      );
    }

    if (isSkp(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[500px]">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading 3D viewer...</div>}>
            <SkpViewer
              fileName={shareData.fileName}
              currentPath=""
              shareToken={token}
              sharePassword={verifiedPassword}
            />
          </Suspense>
        </div>
      );
    }

    if (isXlsx(shareData.fileName)) {
      return (
        <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[500px]">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading spreadsheet...</div>}>
            <XlsxViewer
              fileName={shareData.fileName}
              currentPath=""
              shareToken={token}
              sharePassword={verifiedPassword}
            />
          </Suspense>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-2xl mx-auto">
      <div className="text-center">
        <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
          {fileIcon}
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">{shareData.fileName}</h2>
        <p className="text-gray-500 dark:text-gray-400">
          {formatFileSize(shareData.size)} • Shared by {shareData.ownerUsername}
        </p>
      </div>

      {renderPreview()}

      <div className="mt-6">
        <button
          onClick={handleDownload}
          className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center gap-2"
        >
          <FiDownload size={20} />
          Download
        </button>
      </div>
    </div>
  );
}
