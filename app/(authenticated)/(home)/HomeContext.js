/** @format */

'use client';

import { createContext, useContext } from 'react';

export const HomeContext = createContext({
  searchQuery: '',
  setSearchQuery: () => {},
});

export const useHomeContext = () => useContext(HomeContext);
