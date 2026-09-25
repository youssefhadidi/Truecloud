/** @format */

'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch one sheet of an XLSX file (the server parses one sheet per
 * request and caps it; see lib/xlsxPreviewParse.mjs). While another sheet
 * loads, the previous one stays as placeholder data so the tabs don't vanish.
 */
export function useParseXlsx(fileId, currentPath, sheet, enabled = true) {
  return useQuery({
    queryKey: ['parseXlsx', fileId, currentPath, sheet],
    queryFn: async () => {
      const response = await axios.get('/api/files/parse-xlsx', {
        params: {
          id: fileId,
          path: currentPath,
          sheet,
        },
      });
      return response.data;
    },
    enabled: enabled && !!fileId && currentPath !== undefined,
    placeholderData: keepPreviousData,
    staleTime: Infinity, // XLSX data doesn't change
    gcTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

/**
 * Hook to fetch one sheet of an XLSX file for shared files
 */
export function useParseXlsxShare(shareToken, filePath, sharePassword, sheet) {
  return useQuery({
    queryKey: ['parseXlsxShare', shareToken, filePath, sheet],
    queryFn: async () => {
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.get(`/api/public/${shareToken}/parse-xlsx`, {
        params: { file: filePath, sheet },
        headers,
      });
      return response.data;
    },
    enabled: !!shareToken,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5,
  });
}
