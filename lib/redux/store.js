import { configureStore } from '@reduxjs/toolkit';
import transfersReducer from './slices/transfersSlice';
import fileOpsReducer from './slices/fileOpsSlice';
import selectionReducer from './slices/selectionSlice';
import modalsReducer from './slices/modalsSlice';
import folderCreationReducer from './slices/folderCreationSlice';

export const store = configureStore({
  reducer: {
    transfers: transfersReducer,
    fileOps: fileOpsReducer,
    selection: selectionReducer,
    modals: modalsReducer,
    folderCreation: folderCreationReducer,
  },
});
