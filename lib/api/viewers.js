/** @format */

'use client';

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

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

/**
 * Hook to fetch and parse XLSX file data for shared files
 */
export function useParseXlsxShare(shareToken, filePath, sharePassword) {
  return useQuery({
    queryKey: ['parseXlsxShare', shareToken, filePath],
    queryFn: async () => {
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.get(`/api/public/${shareToken}/parse-xlsx`, {
        params: { file: filePath },
        headers,
      });
      return response.data;
    },
    enabled: !!shareToken,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5,
  });
}
