/** @format */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Hook to fetch all users
 */
export function useUsers(enabled = true) {
  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await axios.get('/api/users');
      return response.data.users || [];
    },
    enabled,
  });

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
 * Hook to create a new user
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userData) => {
      const response = await axios.post('/api/users', userData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Hook to update a user
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userData) => {
      const response = await axios.patch('/api/users', userData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Hook to delete a user
 */
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId) => {
      const response = await axios.delete(`/api/users?id=${userId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
