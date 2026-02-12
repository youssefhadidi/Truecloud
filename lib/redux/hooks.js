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

// Transfer Selector hooks
export const useTransfers = () => useSelector((state) => state.transfers.transfers);
export const useTransferring = () => useSelector((state) => state.transfers.transferring);
export const useTransfersState = () => useSelector((state) => state.transfers);

// Transfer Dispatch hook
export const useTransfersDispatch = () => {
  const dispatch = useDispatch();

  return {
    addTransfer: (transfer) => dispatch(addTransfer(transfer)),
    updateTransfer: (id, updates) => dispatch(updateTransfer({ id, updates })),
    removeTransfer: (id) => dispatch(removeTransfer(id)),
    setTransferring: (transferring) => dispatch(setTransferring(transferring)),
  };
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

  return {
    setDeletingFile: (file) => dispatch(setDeletingFile(file)),
    setRenamingFile: (file) => dispatch(setRenamingFile(file)),
    setNewFileName: (name) => dispatch(setNewFileName(name)),
    setProcessingFile: (fileId) => dispatch(setProcessingFile(fileId)),
    clearAll: () => dispatch(clearAll()),
  };
};

// Selection Selector hooks
export const useSelectionState = () => useSelector((state) => state.selection);
export const useSelectionMode = () => useSelector((state) => state.selection.selectionMode);
export const useSelectedFiles = () => useSelector((state) => state.selection.selectedFiles);

// Selection Dispatch hook
export const useSelectionDispatch = () => {
  const dispatch = useDispatch();

  return {
    setSelectionMode: (mode) => dispatch(setSelectionMode(mode)),
    setSelectedFiles: (files) => dispatch(setSelectedFiles(files)),
    addFileToSelection: (fileId) => dispatch(addFileToSelection(fileId)),
    removeFileFromSelection: (fileId) => dispatch(removeFileFromSelection(fileId)),
    clearSelection: () => dispatch(clearSelection()),
  };
};

// Modals Selector hooks
export const useModalsState = () => useSelector((state) => state.modals);
export const useViewerFile = () => useSelector((state) => state.modals.viewerFile);
export const useSharingFile = () => useSelector((state) => state.modals.sharingFile);
export const useRestoringFile = () => useSelector((state) => state.modals.restoringFile);

// Modals Dispatch hook
export const useModalsDispatch = () => {
  const dispatch = useDispatch();

  return {
    setViewerFile: (file) => dispatch(setViewerFile(file)),
    setSharingFile: (file) => dispatch(setSharingFile(file)),
    setRestoringFile: (file) => dispatch(setRestoringFile(file)),
    closeAllModals: () => dispatch(closeAllModals()),
  };
};

// Folder Creation Selector hooks
export const useFolderCreationState = () => useSelector((state) => state.folderCreation);
export const useCreatingFolder = () => useSelector((state) => state.folderCreation.creatingFolder);
export const useNewFolderName = () => useSelector((state) => state.folderCreation.newFolderName);

// Folder Creation Dispatch hook
export const useFolderCreationDispatch = () => {
  const dispatch = useDispatch();

  return {
    setCreatingFolder: (creating) => dispatch(setCreatingFolder(creating)),
    setNewFolderName: (name) => dispatch(setNewFolderName(name)),
    resetFolderCreation: () => dispatch(resetFolderCreation()),
  };
};
