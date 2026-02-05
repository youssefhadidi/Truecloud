/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

/**
 * Hook to fetch all favorites
 */
export function useFavorites() {
  const { data, isPending, ...rest } = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const response = await axios.get('/api/favorites');
      return response.data.favorites || [];
    },
  });

  const isLoading = isPending && !data;

  return {
    data,
    isPending,
    isLoading,
    ...rest,
  };
}

/**
 * Hook to check if a path is favorited
 */
export function useIsFavorite(path) {
  const { data: favorites } = useFavorites();
  return favorites?.some((f) => f.path === path) || false;
}

/**
 * Hook to add a favorite
 */
export function useAddFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, name, isDirectory }) => {
      const response = await axios.post('/api/favorites', { path, name, isDirectory });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

/**
 * Hook to remove a favorite
 */
export function useRemoveFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, path }) => {
      const params = id ? `id=${id}` : `path=${encodeURIComponent(path)}`;
      const response = await axios.delete(`/api/favorites?${params}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

/**
 * Hook to toggle favorite status
 */
export function useToggleFavorite() {
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();
  const { data: favorites } = useFavorites();

  const toggleFavorite = async ({ path, name, isDirectory }) => {
    const existing = favorites?.find((f) => f.path === path);
    if (existing) {
      return removeFavorite.mutateAsync({ id: existing.id });
    } else {
      return addFavorite.mutateAsync({ path, name, isDirectory });
    }
  };

  return {
    toggleFavorite,
    isPending: addFavorite.isPending || removeFavorite.isPending,
  };
}
