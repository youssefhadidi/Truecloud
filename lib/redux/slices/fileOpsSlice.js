import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  deletingFile: null,
  renamingFile: null,
  newFileName: '',
  processingFile: null,
};

const fileOpsSlice = createSlice({
  name: 'fileOps',
  initialState,
  reducers: {
    // Set file being deleted
    setDeletingFile: (state, action) => {
      state.deletingFile = action.payload;
    },

    // Set file being renamed and initialize newFileName with current name
    setRenamingFile: (state, action) => {
      state.renamingFile = action.payload;
      state.newFileName = action.payload?.name || '';
    },

    // Set the new file name during rename operation
    setNewFileName: (state, action) => {
      state.newFileName = action.payload;
    },

    // Set file currently being processed (zip, convert, etc)
    setProcessingFile: (state, action) => {
      state.processingFile = action.payload;
    },

    // Clear all file operations
    clearAll: (state) => {
      state.deletingFile = null;
      state.renamingFile = null;
      state.newFileName = '';
      state.processingFile = null;
    },
  },
});

export const { setDeletingFile, setRenamingFile, setNewFileName, setProcessingFile, clearAll } =
  fileOpsSlice.actions;

export default fileOpsSlice.reducer;
