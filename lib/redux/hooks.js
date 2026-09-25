import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addTransfer, updateTransfer, removeTransfer, setTransferring } from './slices/transfersSlice';
import {
  setDeletingFile,
  setRenamingFile,
  setNewFileName,
  setProcessingFile,
  clearAll,
} from './slices/fileOpsSlice';
import {
  setSelectionMode,
  setSelectedFiles,
  addFileToSelection,
  removeFileFromSelection,
  clearSelection,
} from './slices/selectionSlice';
import { setViewerFile, setSharingFile, setRestoringFile, closeAllModals } from './slices/modalsSlice';
import { setCreatingFolder, setNewFolderName, resetFolderCreation } from './slices/folderCreationSlice';
import { setDestinationPath, resetDownloads } from './slices/downloadsSlice';

// Transfer Selector hooks
export const useTransfers = () => useSelector((state) => state.transfers.transfers);
export const useTransferring = () => useSelector((state) => state.transfers.transferring);
export const useTransfersState = () => useSelector((state) => state.transfers);

// Transfer Dispatch hook
// Every dispatch hook memoizes its object so the setters keep one identity:
// they are passed to memo'd components, which a fresh object per render defeats.
export const useTransfersDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      addTransfer: (transfer) => dispatch(addTransfer(transfer)),
      updateTransfer: (id, updates) => dispatch(updateTransfer({ id, updates })),
      removeTransfer: (id) => dispatch(removeTransfer(id)),
      setTransferring: (transferring) => dispatch(setTransferring(transferring)),
    }),
    [dispatch],
  );
};

// File Operations Selector hooks
export const useFileOpsState = () => useSelector((state) => state.fileOps);
export const useDeletingFile = () => useSelector((state) => state.fileOps.deletingFile);
export const useRenamingFile = () => useSelector((state) => state.fileOps.renamingFile);
export const useNewFileName = () => useSelector((state) => state.fileOps.newFileName);
export const useProcessingFile = () => useSelector((state) => state.fileOps.processingFile);

// File Operations Dispatch hook
export const useFileOpsDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      setDeletingFile: (file) => dispatch(setDeletingFile(file)),
      setRenamingFile: (file) => dispatch(setRenamingFile(file)),
      setNewFileName: (name) => dispatch(setNewFileName(name)),
      setProcessingFile: (fileId) => dispatch(setProcessingFile(fileId)),
      clearAll: () => dispatch(clearAll()),
    }),
    [dispatch],
  );
};

// Selection Selector hooks
export const useSelectionState = () => useSelector((state) => state.selection);
export const useSelectionMode = () => useSelector((state) => state.selection.selectionMode);
export const useSelectedFiles = () => useSelector((state) => state.selection.selectedFiles);

// Selection Dispatch hook
export const useSelectionDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      setSelectionMode: (mode) => dispatch(setSelectionMode(mode)),
      setSelectedFiles: (files) => dispatch(setSelectedFiles(files)),
      addFileToSelection: (fileId) => dispatch(addFileToSelection(fileId)),
      removeFileFromSelection: (fileId) => dispatch(removeFileFromSelection(fileId)),
      clearSelection: () => dispatch(clearSelection()),
    }),
    [dispatch],
  );
};

// Modals Selector hooks
export const useModalsState = () => useSelector((state) => state.modals);
export const useViewerFile = () => useSelector((state) => state.modals.viewerFile);
export const useSharingFile = () => useSelector((state) => state.modals.sharingFile);
export const useRestoringFile = () => useSelector((state) => state.modals.restoringFile);

// Modals Dispatch hook
export const useModalsDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      setViewerFile: (file) => dispatch(setViewerFile(file)),
      setSharingFile: (file) => dispatch(setSharingFile(file)),
      setRestoringFile: (file) => dispatch(setRestoringFile(file)),
      closeAllModals: () => dispatch(closeAllModals()),
    }),
    [dispatch],
  );
};

// Folder Creation Selector hooks
export const useFolderCreationState = () => useSelector((state) => state.folderCreation);
export const useCreatingFolder = () => useSelector((state) => state.folderCreation.creatingFolder);
export const useNewFolderName = () => useSelector((state) => state.folderCreation.newFolderName);

// Folder Creation Dispatch hook
export const useFolderCreationDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      setCreatingFolder: (creating) => dispatch(setCreatingFolder(creating)),
      setNewFolderName: (name) => dispatch(setNewFolderName(name)),
      resetFolderCreation: () => dispatch(resetFolderCreation()),
    }),
    [dispatch],
  );
};

// Downloads Selector hooks
export const useDownloadsState = () => useSelector((state) => state.downloads);
export const useDownloadDestination = () => useSelector((state) => state.downloads.destinationPath);

// Downloads Dispatch hook
export const useDownloadsDispatch = () => {
  const dispatch = useDispatch();

  return useMemo(
    () => ({
      setDestinationPath: (path) => dispatch(setDestinationPath(path)),
      resetDownloads: () => dispatch(resetDownloads()),
    }),
    [dispatch],
  );
};
