import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  creatingFolder: false,
  newFolderName: '',
};

const folderCreationSlice = createSlice({
  name: 'folderCreation',
  initialState,
  reducers: {
    // Toggle folder creation dialog on/off
    setCreatingFolder: (state, action) => {
      state.creatingFolder = action.payload;
      // Clear folder name when closing dialog
      if (!action.payload) {
        state.newFolderName = '';
      }
    },

    // Set the new folder name being typed
    setNewFolderName: (state, action) => {
      state.newFolderName = action.payload;
    },

    // Reset folder creation state
    resetFolderCreation: (state) => {
      state.creatingFolder = false;
      state.newFolderName = '';
    },
  },
});

export const { setCreatingFolder, setNewFolderName, resetFolderCreation } =
  folderCreationSlice.actions;

export default folderCreationSlice.reducer;
