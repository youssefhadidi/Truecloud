/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch files from a specific path
 */
export function useFiles(currentPath, enabled = true) {
  return useQuery({
    queryKey: ['files', currentPath],
    queryFn: async () => {
      const response = await axios.get(`/api/files?path=${encodeURIComponent(currentPath)}`);
      return response.data.files || [];
    },
    enabled,
  });
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
      formData.append('file', file);
      formData.append('path', currentPath);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            const progress = Math.round((e.loaded / e.total) * 100);
            onProgress(uploadId, progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error('Upload failed'));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error'));
        });

        xhr.open('POST', '/api/files/upload');
        xhr.send(formData);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
    },
  });
}

/**
 * Hook to delete a file or folder
 */
export function useDeleteFile(currentPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId) => {
      const response = await axios.delete(`/api/files?id=${fileId}&path=${encodeURIComponent(currentPath)}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] });
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
 * Hook to check if thumbnail exists or is pending
 */
export function useThumbnailStatus(fileId, filePath, enabled = true) {
  return useQuery({
    queryKey: ['thumbnail', 'status', fileId, filePath],
    queryFn: async () => {
      const response = await axios.get(`/api/files/thumbnail/${fileId}?path=${encodeURIComponent(filePath)}`);
      // If we get here with 200 status and JSON content-type, it's a status response
      return {
        exists: response.data.exists,
        status: response.data.status,
      };
    },
    retry: false,
    enabled,
  });
}

/**
 * Hook to generate a thumbnail in the background
 */
export function useGenerateThumbnail() {
  return useMutation({
    mutationFn: async ({ id, path }) => {
      const response = await axios.post('/api/files/thumbnail/generate', {
        id,
        path,
      });
      return response.data;
    },
  });
}

/**
 * Hook to poll for thumbnail completion
 */
export function useThumbnailReady(fileId, filePath, shouldPoll = false) {
  return useQuery({
    queryKey: ['thumbnail', 'ready', fileId, filePath],
    queryFn: async () => {
      const response = await axios.get(`/api/files/thumbnail/${fileId}?path=${encodeURIComponent(filePath)}`);
      // Check if response is an image (thumbnail is ready)
      if (response.status === 200 && response.headers['content-type']?.includes('image')) {
        return { ready: true };
      }
      // Otherwise it's a JSON status response
      return { ready: response.data.exists === true };
    },
    refetchInterval: shouldPoll ? 500 : false, // Poll every 500ms if enabled
    refetchIntervalInBackground: true,
    retry: false,
    enabled: shouldPoll,
  });
}