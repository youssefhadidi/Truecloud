import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  viewerFile: null,
  sharingFile: null,
  restoringFile: null,
};

const modalsSlice = createSlice({
  name: 'modals',
  initialState,
  reducers: {
    // Set file to be viewed in media viewer
    setViewerFile: (state, action) => {
      state.viewerFile = action.payload;
    },

    // Set file to be shared
    setSharingFile: (state, action) => {
      state.sharingFile = action.payload;
    },

    // Set file to be restored
    setRestoringFile: (state, action) => {
      state.restoringFile = action.payload;
    },

    // Close all modals
    closeAllModals: (state) => {
      state.viewerFile = null;
      state.sharingFile = null;
      state.restoringFile = null;
    },
  },
});

export const { setViewerFile, setSharingFile, setRestoringFile, closeAllModals } = modalsSlice.actions;

export default modalsSlice.reducer;
