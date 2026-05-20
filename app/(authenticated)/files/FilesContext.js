/** @format */

'use client';

import { createContext, useContext } from 'react';

export const FilesContext = createContext({
  searchQuery: '',
  setSearchQuery: () => {},
});

export const useFilesContext = () => useContext(FilesContext);
