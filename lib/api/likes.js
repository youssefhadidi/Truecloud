/** @format */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch the current user's liked files
 */
export function useLikedFiles() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['likedFiles'],
    queryFn: async () => {
      const response = await axios.get('/api/likes');
      return response.data.liked || [];
    },
  });

  const isLoading = isPending && !data;

  return { data, isPending, isLoading, ...rest };
}

/**
 * Hook returning the set of liked paths, for cheap lookups in file listings
 */
export function useLikedPaths() {
  const { data: liked } = useLikedFiles();
  return useMemo(() => new Set((liked || []).map((f) => f.path)), [liked]);
}

/**
 * Hook to like a file
 */
export function useLikeFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, name }) => {
      const response = await axios.post('/api/likes', { path, name });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['likedFiles'] });
    },
  });
}

/**
 * Hook to unlike a file
 */
export function useUnlikeFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, path }) => {
      const params = id ? `id=${id}` : `path=${encodeURIComponent(path)}`;
      const response = await axios.delete(`/api/likes?${params}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['likedFiles'] });
    },
  });
}

/**
 * Hook to toggle a file's liked state.
 * Resolves to `{ liked }` so callers can report which way it went.
 */
export function useToggleLike() {
  const likeFile = useLikeFile();
  const unlikeFile = useUnlikeFile();
  const { data: liked } = useLikedFiles();

  const toggleLike = useCallback(
    async ({ path, name }) => {
      const existing = liked?.find((f) => f.path === path);
      if (existing) {
        await unlikeFile.mutateAsync({ id: existing.id });
        return { liked: false };
      }
      await likeFile.mutateAsync({ path, name });
      return { liked: true };
    },
    [liked, likeFile, unlikeFile],
  );

  return {
    toggleLike,
    isPending: likeFile.isPending || unlikeFile.isPending,
  };
}
