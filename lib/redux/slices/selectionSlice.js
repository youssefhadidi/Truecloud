import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  selectionMode: false,
  selectedFiles: [],
};

const selectionSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    // Toggle selection mode on/off
    setSelectionMode: (state, action) => {
      state.selectionMode = action.payload;
    },

    // Set selected files array
    setSelectedFiles: (state, action) => {
      state.selectedFiles = action.payload;
    },

    // Add file to selection
    addFileToSelection: (state, action) => {
      if (!state.selectedFiles.includes(action.payload)) {
        state.selectedFiles.push(action.payload);
      }
    },

    // Remove file from selection
    removeFileFromSelection: (state, action) => {
      state.selectedFiles = state.selectedFiles.filter((id) => id !== action.payload);
    },

    // Clear all selections
    clearSelection: (state) => {
      state.selectionMode = false;
      state.selectedFiles = [];
    },
  },
});

export const {
  setSelectionMode,
  setSelectedFiles,
  addFileToSelection,
  removeFileFromSelection,
  clearSelection,
} = selectionSlice.actions;

export default selectionSlice.reducer;
