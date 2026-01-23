/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';

let isLoggingOut = false;

// Add response interceptor to handle 403 errors
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Check if it's a 403 error (session expired)
    if (error.response?.status === 403 && !isLoggingOut) {
      isLoggingOut = true;

      try {
        // Sign out the user
        await signOut({
          redirect: true,
          callbackUrl: '/auth/login',
        });
      } catch (signOutError) {
        console.error('Error during automatic logout:', signOutError);
        // Force redirect if signOut fails
        window.location.href = '/auth/login';
      } finally {
        isLoggingOut = false;
      }
    }

    return Promise.reject(error);
  }
);

export default axios;
