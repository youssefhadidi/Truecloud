/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch files and downloads from a specific path
 * Returns both files and downloads in a single request to /api/files
 */
export function useFiles(currentPath, enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['files', currentPath],
    queryFn: async () => {
      const response = await axios.get(`/api/files?path=${encodeURIComponent(currentPath)}`);
      return {
        files: response.data.files || [],
        downloads: response.data.downloads || [],
      };
    },
    enabled,
  });

  // Only show loading state on initial load, not on background refetches
  const isLoading = isPending && !data;

  return {
    files: data?.files || [],
    downloads: data?.downloads || [],
    isPending,
    isFetching,
    isLoading,
    ...rest,
  };
}

/**
 * Hook to create a new folder
 */
export function useCreateFolder(currentPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderName) => {
      const response = await axios.post('/api/files/mkdir', {
        name: folderName,
        path: currentPath,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
    },
  });
}

/**
 * Hook to upload a file
 */
export function useUploadFile(currentPath, onProgress) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, uploadId }) => {
      const formData = new FormData();
      formData.append('file', file, file?.name);

      const response = await axios.post(`/api/files/upload?path=${encodeURIComponent(currentPath)}`, formData, {
        headers: {
          Accept: 'application/json',
        },
        timeout: 30 * 60 * 1000,
        onUploadProgress: (event) => {
          if (event.total && onProgress) {
            const progress = Math.round((event.loaded / event.total) * 100);
            onProgress(uploadId, progress);
          }
        },
      });

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
    },
  });
}

/**
 * Hook to delete a file or folder (moves to trash, or permanently deletes if in trash)
 */
export function useDeleteFile(currentPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId) => {
      const response = await axios.delete(`/api/files?id=${fileId}&path=${encodeURIComponent(currentPath)}`);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
      // If moved to trash, also invalidate trash folder
      if (data.movedToTrash) {
        queryClient.invalidateQueries({ queryKey: ['files', 'trash'] });
      }
    },
  });
}

/**
 * Hook to restore a file from trash
 */
export function useRestoreFile(currentPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId) => {
      const response = await axios.post(`/api/files/restore?id=${fileId}&path=${encodeURIComponent(currentPath)}`);
      return response.data;
    },
    onSuccess: (data) => {
      // Invalidate current trash folder view
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
      // Invalidate the restored location
      if (data.restoredTo !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['files', data.restoredTo] });
      }
      // Invalidate root if restored to root
      queryClient.invalidateQueries({ queryKey: ['files', ''] });
    },
  });
}

/**
 * Hook to rename a file or folder
 */
export function useRenameFile(currentPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fileId, newName }) => {
      const response = await axios.patch(`/api/files?id=${fileId}&path=${encodeURIComponent(currentPath)}`, {
        newName,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
    },
  });
}

/**
 * Hook to move files or folders
 */
export function useMoveFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ items, sourcePath, destinationPath }) => {
      const response = await axios.post('/api/files/move', {
        items,
        sourcePath,
        destinationPath,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}
/**
 * Get the URL for a thumbnail (generates on-demand server-side)
 * Returns null if fileId is missing
 */
export function getThumbnailUrl(fileId, filePath = '') {
  if (!fileId) return null;
  return `/api/files/thumbnail/${encodeURIComponent(fileId)}?path=${encodeURIComponent(filePath || '')}`;
}

/**
 * Get the URL for a share thumbnail (generates on-demand server-side)
 * Returns null if shareToken or fileName is missing
 */
export function getShareThumbnailUrl(shareToken, fileName, filePath = '', sharePassword = '') {
  if (!shareToken || !fileName) return null;
  const params = new URLSearchParams();
  params.append('file', fileName);
  if (filePath) {
    params.append('path', filePath);
  }
  if (sharePassword) {
    params.append('pwd', sharePassword);
  }
  return `/api/public/${shareToken}/thumbnail?${params.toString()}`;
}

/**
 * Hook to fetch user's shares
 */
export function useShares() {
  return useQuery({
    queryKey: ['shares'],
    queryFn: async () => {
      const response = await axios.get('/api/shares');
      return response.data.shares || [];
    },
  });
}

/**
 * Hook to fetch shares for the current path (to show share indicators)
 */
export function usePathShares(currentPath) {
  return useQuery({
    queryKey: ['shares'],
    queryFn: async () => {
      const response = await axios.get('/api/shares');
      return response.data.shares || [];
    },
    select: (shares) => {
      // Create a Set of shared file identifiers for quick lookup
      return new Set(shares.map((s) => `${s.path}/${s.fileName}`.replace(/\/+/g, '/')));
    },
  });
}

/**
 * Hook to check if a specific file is shared
 */
export function useFileShare(path, fileName) {
  return useQuery({
    queryKey: ['fileShare', path, fileName],
    queryFn: async () => {
      const response = await axios.get(`/api/shares?path=${encodeURIComponent(path)}&fileName=${encodeURIComponent(fileName)}`);
      return response.data.share || null;
    },
    enabled: !!fileName,
  });
}

/**
 * Hook to create a share
 */
export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareData) => {
      const response = await axios.post('/api/shares', shareData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      queryClient.invalidateQueries({ queryKey: ['fileShare'] });
    },
  });
}

/**
 * Hook to update a share
 */
export function useUpdateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shareId, data }) => {
      const response = await axios.patch(`/api/shares/${shareId}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      queryClient.invalidateQueries({ queryKey: ['fileShare'] });
    },
  });
}

/**
 * Hook to delete a share
 */
export function useDeleteShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareId) => {
      await axios.delete(`/api/shares/${shareId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      queryClient.invalidateQueries({ queryKey: ['fileShare'] });
    },
  });
}
