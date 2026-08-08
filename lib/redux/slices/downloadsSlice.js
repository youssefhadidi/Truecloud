import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  // Last folder destination typed on /files/downloads. Shared by the search
  // panel and the manual download form so a destination entered in one is
  // still there in the other, and survives leaving and re-entering the page.
  destinationPath: '',
};

const downloadsSlice = createSlice({
  name: 'downloads',
  initialState,
  reducers: {
    setDestinationPath: (state, action) => {
      state.destinationPath = action.payload;
    },

    resetDownloads: (state) => {
      state.destinationPath = '';
    },
  },
});

export const { setDestinationPath, resetDownloads } = downloadsSlice.actions;

export default downloadsSlice.reducer;
