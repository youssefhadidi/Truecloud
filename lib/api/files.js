/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch files from a specific path
 */
export function useFiles(currentPath, enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['files', currentPath],
    queryFn: async () => {
      const response = await axios.get(`/api/files?path=${encodeURIComponent(currentPath)}`);
      return response.data.files || [];
    },
    enabled,
  });

  // Only show loading state on initial load, not on background refetches
  const isLoading = isPending && !data;

  return {
    data,
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
            try {
              resolve(JSON.parse(xhr.response));
            } catch {
              resolve(xhr.response);
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload aborted'));
        });

        xhr.open('POST', '/api/files/upload');
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.responseType = 'text';
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
 * Hook to fetch thumbnail (generates if needed, returns base64)
 */
export function useThumbnail(fileId, filePath, enabled = true) {
  return useQuery({
    queryKey: ['thumbnail', fileId, filePath],
    queryFn: async () => {
      const response = await axios.get(`/api/files/thumbnail/${fileId}?path=${encodeURIComponent(filePath)}`);
      return response.data; // { data: "data:image/jpeg;base64,...", generated: boolean }
    },
    retry: 1,
    staleTime: Infinity, // Thumbnails don't change
    cacheTime: Infinity,
    enabled,
  });
}
