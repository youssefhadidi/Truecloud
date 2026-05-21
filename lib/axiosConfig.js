/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';

let isLoggingOut = false;

// Handler invoked when the server returns 423 (session locked).
// Set by SessionLockProvider so the lock screen renders without waiting
// for the next 30s session poll.
let onSessionLocked = null;

export function setSessionLockedHandler(fn) {
  onSessionLocked = fn;
}

// Add response interceptor to handle 403 errors
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
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
