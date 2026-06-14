/** @format */

import { useCreateFolder, useUploadFile, useDeleteFile, useRenameFile, useRestoreFile } from '@/lib/api/files';
import { useStartDownload } from '@/lib/api/downloads';
import { useTransfersDispatch } from '@/lib/redux/hooks';
import { useTranslation } from '@/components/LanguageProvider';

// Helper to check if path is in trash
const isInTrash = (path) => path === 'trash' || path.startsWith('trash/') || path.startsWith('trash\\');

export function useFileHandlers({
  currentPath,
  setCreatingFolder,
  setNewFolderName,
  newFolderName,
  addNotification,
  setDeletingFile,
  setProcessingFile,
  setRenamingFile,
  setNewFileName,
  setSharingFile,
  setRestoringFile,
  pauseDownload,
  resumeDownload,
  removeDownload,
}) {
  const { addTransfer, updateTransfer, removeTransfer, setTransferring } = useTransfersDispatch();
  const { t } = useTranslation();

  // Mutations
  const createFolderMutation = useCreateFolder(currentPath);
  const uploadMutation = useUploadFile((uploadId, progress) => {
    updateTransfer(uploadId, { progress });
  });
  const startDownloadMutation = useStartDownload();
  const deleteMutation = useDeleteFile(currentPath);
  const renameMutation = useRenameFile(currentPath);
  const restoreMutation = useRestoreFile(currentPath);

  // Folder operations
  const initiateCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName(t('files.newFolder'));
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
        addNotification('success', t('notify.folderCreated'));
      },
      onError: (error) => {
        console.error('Create folder error:', error);
        addNotification('error', error.message || t('notify.folderCreateFailed'), t('notify.titles.error'));
        setCreatingFolder(false);
      },
    });
  };

  // Upload operations
  const uploadSingleFile = (file, uploadPath) => {
    const uploadId = Date.now() + Math.random();

    addTransfer({
      id: uploadId,
      fileName: file.name,
      progress: 0,
      status: 'uploading',
      type: 'upload',
    });

    return new Promise((resolve) => {
      uploadMutation.mutate(
        { file, uploadId, path: uploadPath },
        {
          onSuccess: () => {
            updateTransfer(uploadId, { status: 'success', progress: 100 });
            setTimeout(() => {
              removeTransfer(uploadId);
            }, 3000);
            resolve();
          },
          onError: (error) => {
            console.error('Upload error:', error);
            updateTransfer(uploadId, { status: 'error', error: error.message });
            addNotification('error', t('notify.uploadFailedFor', { name: file.name }), t('notify.titles.uploadError'));
            resolve();
          },
        },
      );
    });
  };

  const startTorrentDownload = async (torrentFile) => {
    try {
      const formData = new FormData();
      formData.append('torrentFile', torrentFile);
      formData.append('path', currentPath);

      await startDownloadMutation.mutateAsync({ formData, path: currentPath });

      addNotification('success', t('notify.startedDownloading', { name: torrentFile.name }));
    } catch (error) {
      console.error('Torrent download error:', error);
      addNotification('error', t('notify.failedStartDownload', { message: error.message }), t('notify.titles.downloadError'));
    }
  };

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;

    const uploadPath = currentPath;

    // Separate torrent files from regular uploads
    const torrentFiles = files.filter((f) => f.name.toLowerCase().endsWith('.torrent'));
    const regularFiles = files.filter((f) => !f.name.toLowerCase().endsWith('.torrent'));

    // Handle torrent downloads
    for (const torrentFile of torrentFiles) {
      await startTorrentDownload(torrentFile);
    }

    // Handle regular uploads
    if (regularFiles.length > 0) {
      setTransferring(true);
      for (const file of regularFiles) {
        await uploadSingleFile(file, uploadPath);
      }
      setTransferring(false);
    }
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
      addNotification('error', t('notify.cannotDeleteInvalid'));
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
      addNotification('error', t('notify.cannotDeleteFileInvalid'));
      setDeletingFile(null);
      return;
    }
    setProcessingFile(deletingFile.id);
    deleteMutation.mutate(deletingFile.id, {
      onSuccess: (data) => {
        setDeletingFile(null);
        setProcessingFile(null);
        if (data.movedToTrash) {
          addNotification('success', t('notify.movedToTrash'));
        } else {
          addNotification('success', t('notify.permanentlyDeleted'));
        }
      },
      onError: (error) => {
        console.error('Delete error:', error);
        addNotification('error', error.message || t('notify.deleteFailed'), t('notify.titles.deleteError'));
        setDeletingFile(null);
        setProcessingFile(null);
      },
    });
  };

  // Rename operations
  const initiateRename = (file, closeContextMenu) => {
    if (!file || !file.id || !file.name) {
      console.error('initiateRename: Invalid file object', file);
      addNotification('error', t('notify.cannotRenameInvalid'));
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
      addNotification('error', t('notify.cannotRenameFileInvalid'));
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
          addNotification('success', t('notify.fileRenamed'));
        },
        onError: (error) => {
          console.error('Rename error:', error);
          addNotification('error', error.message || t('notify.renameFailed'), t('notify.titles.renameError'));
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
      addNotification('error', t('notify.cannotShareInvalid'));
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
      addNotification('error', t('notify.cannotRestoreInvalid'));
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
      addNotification('error', t('notify.cannotRestoreFileInvalid'));
      if (setRestoringFile) setRestoringFile(null);
      return;
    }
    setProcessingFile(restoringFile.id);
    restoreMutation.mutate(restoringFile.id, {
      onSuccess: (data) => {
        if (setRestoringFile) setRestoringFile(null);
        setProcessingFile(null);
        addNotification('success', t('notify.restoredTo', { location: data.restoredTo || t('notify.originalLocation') }));
      },
      onError: (error) => {
        console.error('Restore error:', error);
        addNotification('error', error.message || t('notify.restoreFailed'), t('notify.titles.restoreError'));
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
    pauseDownload,
    resumeDownload,
    removeDownload,
    isInTrash: isInTrash(currentPath),
  };
}
