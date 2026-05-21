/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';

let isLoggingOut = false;
let isReloadingForVersion = false;

// Handler invoked when the server returns 423 (session locked).
// Set by SessionLockProvider so the lock screen renders without waiting
// for the next 30s session poll.
let onSessionLocked = null;

export function setSessionLockedHandler(fn) {
  onSessionLocked = fn;
}

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

    const status = error.response?.status;

    if (status === 423 && onSessionLocked) {
      try { await onSessionLocked(); } catch {}
    } else if (status === 403 && !isLoggingOut) {
      isLoggingOut = true;
      try {
        await signOut({
          redirect: true,
          callbackUrl: '/auth/login',
        });
      } catch (signOutError) {
        console.error('Error during automatic logout:', signOutError);
        window.location.href = '/auth/login';
      } finally {
        isLoggingOut = false;
      }
    }

    return Promise.reject(error);
  }
);

export default axios;
