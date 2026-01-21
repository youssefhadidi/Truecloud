/** @format */

import { useCreateFolder, useUploadFile, useDeleteFile, useRenameFile } from '@/lib/api/files';

export function useFileHandlers({
  currentPath,
  setCreatingFolder,
  setNewFolderName,
  addNotification,
  setUploads,
  setUploading,
  setDeletingFile,
  setProcessingFile,
  setRenamingFile,
  setNewFileName,
}) {
  // Mutations
  const createFolderMutation = useCreateFolder(currentPath);
  const uploadMutation = useUploadFile(currentPath, (uploadId, progress) => {
    setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, progress } : u)));
  });
  const deleteMutation = useDeleteFile(currentPath);
  const renameMutation = useRenameFile(currentPath);

  // Folder operations
  const initiateCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName('New Folder');
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const confirmCreateFolder = (newFolderName) => {
    if (!newFolderName.trim()) {
      cancelCreateFolder();
      return;
    }
    createFolderMutation.mutate(newFolderName, {
      onSuccess: () => {
        setCreatingFolder(false);
        setNewFolderName('');
        addNotification('success', 'Folder created successfully');
      },
      onError: (error) => {
        console.error('Create folder error:', error);
        addNotification('error', error.message || 'Failed to create folder', 'Error');
        setCreatingFolder(false);
      },
    });
  };

  // Upload operations
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
          addNotification('error', `Upload failed for ${file.name}`, 'Upload Error');
          setUploading(false);
        },
      },
    );
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const handleDrop = async (files) => {
    for (const file of files) {
      await uploadFile(file);
    }
  };

  // Delete operations
  const initiateDelete = (file, closeContextMenu) => {
    setDeletingFile(file);
    if (closeContextMenu) closeContextMenu();
  };

  const cancelDelete = () => {
    setDeletingFile(null);
  };

  const confirmDelete = (deletingFile) => {
    if (!deletingFile) return;
    setProcessingFile(deletingFile.id);
    deleteMutation.mutate(deletingFile.id, {
      onSuccess: () => {
        setDeletingFile(null);
        setProcessingFile(null);
        addNotification('success', 'File deleted successfully');
      },
      onError: (error) => {
        console.error('Delete error:', error);
        addNotification('error', error.message || 'Failed to delete file', 'Delete Error');
        setDeletingFile(null);
        setProcessingFile(null);
      },
    });
  };

  // Rename operations
  const initiateRename = (file, closeContextMenu) => {
    setRenamingFile(file);
    setNewFileName(file.name);
    if (closeContextMenu) closeContextMenu();
  };

  const cancelRename = () => {
    setRenamingFile(null);
    setNewFileName('');
  };

  const confirmRename = (renamingFile, newFileName) => {
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
          setProcessingFile(null);
          addNotification('success', 'File renamed successfully');
        },
        onError: (error) => {
          console.error('Rename error:', error);
          addNotification('error', error.message || 'Failed to rename file', 'Rename Error');
          setRenamingFile(null);
          setProcessingFile(null);
        },
      },
    );
  };

  return {
    initiateCreateFolder,
    cancelCreateFolder,
    confirmCreateFolder,
    uploadFile,
    handleUpload,
    handleDrop,
    initiateDelete,
    cancelDelete,
    confirmDelete,
    initiateRename,
    cancelRename,
    confirmRename,
  };
}
