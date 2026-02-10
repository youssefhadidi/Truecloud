/** @format */

import { useCreateFolder, useUploadFile, useDeleteFile, useRenameFile, useRestoreFile } from '@/lib/api/files';

// Helper to check if path is in trash
const isInTrash = (path) => path === 'trash' || path.startsWith('trash/') || path.startsWith('trash\\');

export function useFileHandlers({
  currentPath,
  setCreatingFolder,
  setNewFolderName,
  newFolderName,
  addNotification,
  setUploads,
  setUploading,
  setDeletingFile,
  setProcessingFile,
  setRenamingFile,
  setNewFileName,
  setSharingFile,
  setRestoringFile,
}) {
  // Mutations
  const createFolderMutation = useCreateFolder(currentPath);
  const uploadMutation = useUploadFile(currentPath, (uploadId, progress) => {
    setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, progress } : u)));
  });
  const deleteMutation = useDeleteFile(currentPath);
  const renameMutation = useRenameFile(currentPath);
  const restoreMutation = useRestoreFile(currentPath);

  // Folder operations
  const initiateCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName('New Folder');
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const confirmCreateFolder = (folderNameParam) => {
    const folderName = folderNameParam || newFolderName;
    if (!folderName || !folderName.trim()) {
      cancelCreateFolder();
      return;
    }
    createFolderMutation.mutate(folderName, {
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
  const uploadSingleFile = (file) => {
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

    return new Promise((resolve) => {
      uploadMutation.mutate(
        { file, uploadId },
        {
          onSuccess: () => {
            setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'success', progress: 100 } : u)));
            setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.id !== uploadId));
            }, 3000);
            resolve();
          },
          onError: (error) => {
            console.error('Upload error:', error);
            setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'error', error: error.message } : u)));
            addNotification('error', `Upload failed for ${file.name}`, 'Upload Error');
            resolve();
          },
        },
      );
    });
  };

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      await uploadSingleFile(file);
    }
    setUploading(false);
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await uploadFiles(files);
    e.target.value = '';
  };

  const handleDrop = async (files) => {
    await uploadFiles(files);
  };

  // Delete operations
  const initiateDelete = (file, closeContextMenu) => {
    if (!file || !file.id) {
      console.error('initiateDelete: Invalid file object', file);
      addNotification('error', 'Cannot delete: Invalid file data');
      return;
    }
    setDeletingFile(file);
    if (closeContextMenu) closeContextMenu();
  };

  const cancelDelete = () => {
    setDeletingFile(null);
  };

  const confirmDelete = (deletingFile) => {
    if (!deletingFile || !deletingFile.id) {
      console.error('confirmDelete: Invalid file object', deletingFile);
      addNotification('error', 'Cannot delete file: Invalid file data');
      setDeletingFile(null);
      return;
    }
    setProcessingFile(deletingFile.id);
    deleteMutation.mutate(deletingFile.id, {
      onSuccess: (data) => {
        setDeletingFile(null);
        setProcessingFile(null);
        if (data.movedToTrash) {
          addNotification('success', 'Moved to trash');
        } else {
          addNotification('success', 'Permanently deleted');
        }
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
    if (!file || !file.id || !file.name) {
      console.error('initiateRename: Invalid file object', file);
      addNotification('error', 'Cannot rename: Invalid file data');
      return;
    }
    setRenamingFile(file);
    setNewFileName(file.name);
    if (closeContextMenu) closeContextMenu();
  };

  const cancelRename = () => {
    setRenamingFile(null);
    setNewFileName('');
  };

  const confirmRename = (renamingFile, newFileName) => {
    if (!renamingFile || !renamingFile.id) {
      console.error('confirmRename: Invalid file object', renamingFile);
      addNotification('error', 'Cannot rename file: Invalid file data');
      setRenamingFile(null);
      setNewFileName('');
      return;
    }
    if (!newFileName.trim() || newFileName === renamingFile.name) {
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

  // Share operations
  const initiateShare = (file, closeContextMenu) => {
    if (!file || !file.id || !file.name) {
      console.error('initiateShare: Invalid file object', file);
      addNotification('error', 'Cannot share: Invalid file data');
      return;
    }
    setSharingFile(file);
    if (closeContextMenu) closeContextMenu();
  };

  const cancelShare = () => {
    setSharingFile(null);
  };

  // Restore operations (for trash)
  const initiateRestore = (file, closeContextMenu) => {
    if (!file || !file.id) {
      console.error('initiateRestore: Invalid file object', file);
      addNotification('error', 'Cannot restore: Invalid file data');
      return;
    }
    if (setRestoringFile) {
      setRestoringFile(file);
    }
    if (closeContextMenu) closeContextMenu();
  };

  const cancelRestore = () => {
    if (setRestoringFile) {
      setRestoringFile(null);
    }
  };

  const confirmRestore = (restoringFile) => {
    if (!restoringFile || !restoringFile.id) {
      console.error('confirmRestore: Invalid file object', restoringFile);
      addNotification('error', 'Cannot restore file: Invalid file data');
      if (setRestoringFile) setRestoringFile(null);
      return;
    }
    setProcessingFile(restoringFile.id);
    restoreMutation.mutate(restoringFile.id, {
      onSuccess: (data) => {
        if (setRestoringFile) setRestoringFile(null);
        setProcessingFile(null);
        addNotification('success', `Restored to ${data.restoredTo || 'original location'}`);
      },
      onError: (error) => {
        console.error('Restore error:', error);
        addNotification('error', error.message || 'Failed to restore file', 'Restore Error');
        if (setRestoringFile) setRestoringFile(null);
        setProcessingFile(null);
      },
    });
  };

  return {
    initiateCreateFolder,
    cancelCreateFolder,
    confirmCreateFolder,
    handleUpload,
    handleDrop,
    initiateDelete,
    cancelDelete,
    confirmDelete,
    initiateRename,
    cancelRename,
    confirmRename,
    initiateShare,
    cancelShare,
    initiateRestore,
    cancelRestore,
    confirmRestore,
    isInTrash: isInTrash(currentPath),
  };
}
