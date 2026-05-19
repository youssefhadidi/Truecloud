/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';

let isLoggingOut = false;
let isReloadingForVersion = false;

function checkAppVersion(headers) {
  if (typeof window === 'undefined' || isReloadingForVersion) return;
  const newVersion = headers?.['x-app-version'];
  if (!newVersion) return;
  const lastVersion = localStorage.getItem('app_version');
  if (!lastVersion) {
    localStorage.setItem('app_version', newVersion);
    return;
  }
  if (newVersion !== lastVersion) {
    isReloadingForVersion = true;
    console.log('ℹ️ New app version detected on response, reloading.', { old: lastVersion, new: newVersion });
    localStorage.setItem('app_version', newVersion);
    window.location.reload();
  }
}

// Add response interceptor to handle 403 errors and detect new app versions
axios.interceptors.response.use(
  (response) => {
    checkAppVersion(response.headers);
    return response;
  },
  async (error) => {
    if (error.response?.headers) checkAppVersion(error.response.headers);
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
