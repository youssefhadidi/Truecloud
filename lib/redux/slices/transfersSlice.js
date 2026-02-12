import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  transferring: false,
  transfers: [], // Array of { id, fileName, progress, status, type: 'upload'|'download', error? }
};

const transfersSlice = createSlice({
  name: 'transfers',
  initialState,
  reducers: {
    // Add a new transfer (upload or download)
    addTransfer: (state, action) => {
      state.transfers.push(action.payload);
    },

    // Update progress, status, or error of an existing transfer
    updateTransfer: (state, action) => {
      const transfer = state.transfers.find((t) => t.id === action.payload.id);
      if (transfer) {
        Object.assign(transfer, action.payload.updates);
      }
    },

    // Remove a completed transfer from the list
    removeTransfer: (state, action) => {
      state.transfers = state.transfers.filter((t) => t.id !== action.payload);
    },

    // Set global transferring flag
    setTransferring: (state, action) => {
      state.transferring = action.payload;
    },

    // Clear all transfers
    clearAllTransfers: (state) => {
      state.transfers = [];
    },
  },
});

export const { addTransfer, updateTransfer, removeTransfer, setTransferring, clearAllTransfers } =
  transfersSlice.actions;

export default transfersSlice.reducer;
