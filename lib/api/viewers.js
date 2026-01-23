/** @format */

'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch and parse XLSX file data
 */
export function useParseXlsx(fileId, currentPath) {
  return useQuery({
    queryKey: ['parseXlsx', fileId, currentPath],
    queryFn: async () => {
      const response = await axios.get('/api/files/parse-xlsx', {
        params: {
          id: fileId,
          path: currentPath,
        },
      });
      return response.data;
    },
    enabled: !!fileId && currentPath !== undefined,
    staleTime: Infinity, // XLSX data doesn't change
    gcTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}
