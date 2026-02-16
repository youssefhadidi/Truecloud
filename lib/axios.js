/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';

// Create axios instance
export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
});

/**
 * Setup axios interceptor to handle authentication errors
 * - 423: Session is locked - refresh session to show lock screen
 * - 401: Session expired - logout user
 */
export function setupAxiosInterceptor(updateSession) {
  apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response?.status;

      if (status === 423) {
        // Session is locked - refresh session to show lock screen
        await updateSession();
      } else if (status === 401) {
        // Session expired or invalid - logout user
        await signOut({ redirect: true, callbackUrl: '/auth/login' });
      }

      return Promise.reject(error);
    }
  );
}
