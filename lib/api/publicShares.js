/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch public share metadata
 */
export function useShare(token, submittedPassword) {
  return useQuery({
    queryKey: ['share', token, submittedPassword],
    queryFn: async () => {
      try {
        const headers = submittedPassword ? { 'x-share-password': submittedPassword } : {};
        const response = await axios.get(`/api/public/${token}`, { headers });
        return response.data;
      } catch (error) {
        if (error.response?.status === 401 && error.response?.data?.requiresPassword) {
          return { requiresPassword: true, fileName: error.response.data.fileName, isDirectory: error.response.data.isDirectory };
        }
        throw new Error(error.response?.data?.error || 'Share not found');
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Hook to fetch files in a public share directory
 */
export function useShareFiles(token, submittedPassword, currentSubPath, enabled = true) {
  return useQuery({
    queryKey: ['share-files', token, submittedPassword, currentSubPath],
    queryFn: async () => {
      const headers = submittedPassword ? { 'x-share-password': submittedPassword } : {};
      const params = new URLSearchParams();
      if (currentSubPath) {
        params.append('path', currentSubPath);
      }
      const url = params.toString() ? `/api/public/${token}/files?${params.toString()}` : `/api/public/${token}/files`;
      const response = await axios.get(url, { headers });
      return response.data.files;
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to download a file as a blob (for Web Share API)
 */
export function useDownloadFileBlob() {
  return useMutation({
    mutationFn: async ({ url, onProgress }) => {
      const response = await axios.get(url, {
        responseType: 'blob',
        onDownloadProgress: onProgress,
      });
      return response.data;
    },
  });
}

/**
 * Hook to fetch share folders for move operations
 */
export function useGetShareFolders() {
  return useMutation({
    mutationFn: async ({ token, submittedPassword, path }) => {
      const headers = submittedPassword ? { 'x-share-password': submittedPassword } : {};
      const params = new URLSearchParams();
      if (path) {
        params.append('path', path);
      }
      const url = params.toString() ? `/api/public/${token}/files?${params.toString()}` : `/api/public/${token}/files`;
      const response = await axios.get(url, { headers });
      return (response.data.files || []).filter((file) => file.isDirectory);
    },
  });
}

/**
 * Hook to create a folder in a public share
 */
export function useCreateShareFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, sharePassword, folderName, currentSubPath }) => {
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.post(`/api/public/${token}/mkdir`, {
        name: folderName,
        path: currentSubPath,
      }, { headers });
      return response.data;
    },
    onSuccess: (_, { token, sharePassword, currentSubPath }) => {
      // Invalidate both share and file listings
      queryClient.invalidateQueries({ queryKey: ['share-files', token, sharePassword, currentSubPath] });
      queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    },
  });
}

/**
 * Hook to delete a file/folder from a public share
 */
export function useDeleteShareFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, sharePassword, fileName, currentSubPath }) => {
      const params = new URLSearchParams();
      params.append('file', fileName);
      if (currentSubPath) {
        params.append('path', currentSubPath);
      }
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.delete(`/api/public/${token}/delete?${params.toString()}`, { headers });
      return response.data;
    },
    onSuccess: (_, { token, sharePassword, currentSubPath }) => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, sharePassword, currentSubPath] });
      queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    },
  });
}

/**
 * Hook to rename a file/folder in a public share
 */
export function useRenameShareFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, sharePassword, oldName, newName, currentSubPath }) => {
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.patch(`/api/public/${token}/rename`, {
        oldName,
        newName,
        path: currentSubPath,
      }, { headers });
      return response.data;
    },
    onSuccess: (_, { token, sharePassword, currentSubPath }) => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, sharePassword, currentSubPath] });
      queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    },
  });
}

/**
 * Hook to move files/folders in a public share
 */
export function useMoveShareFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, sharePassword, items, sourcePath, destinationPath }) => {
      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.post(`/api/public/${token}/move`, {
        items,
        sourcePath,
        destinationPath,
      }, { headers });
      return response.data;
    },
    onSuccess: (_, { token, sharePassword }) => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, sharePassword] });
      queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    },
  });
}

/**
 * Hook to upload files to a public share
 */
export function useUploadShareFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, sharePassword, file, currentSubPath }) => {
      const formData = new FormData();
      formData.append('file', file);

      const params = new URLSearchParams();
      if (currentSubPath) {
        params.append('path', currentSubPath);
      }

      const headers = sharePassword ? { 'x-share-password': sharePassword } : {};
      const response = await axios.post(
        `/api/public/${token}/upload?${params.toString()}`,
        formData,
        { headers }
      );
      return response.data;
    },
    onSuccess: (_, { token, sharePassword, currentSubPath }) => {
      queryClient.invalidateQueries({ queryKey: ['share-files', token, sharePassword, currentSubPath] });
      queryClient.invalidateQueries({ queryKey: ['share-files', token] });
    },
  });
}
