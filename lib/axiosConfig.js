/** @format */

import axios from 'axios';
import { signOut } from 'next-auth/react';
import { getAllFolderPinsForInterceptor } from './folderPinStore';

let isLoggingOut = false;

// Request interceptor: attach the in-memory folder-pin map so any API call
// targeting a path inside a passcode-locked folder carries the right PIN.
// The server picks the entry matching the ancestor lock — see
// lib/folderLocks.js#requireFolderUnlock. We avoid axios.defaults.headers
// here because that's a single global slot and we want per-folder pins.
axios.interceptors.request.use((config) => {
  if (typeof window === 'undefined') return config;
  // Skip when the caller already set X-Folder-Pin explicitly (the PIN modal
  // probe does this to verify a freshly-entered PIN before storing it).
  const headers = config.headers || {};
  if (headers['X-Folder-Pin'] || headers['x-folder-pin']) return config;
  const snapshot = getAllFolderPinsForInterceptor();
  if (!snapshot || snapshot.size === 0) return config;
  const obj = Object.fromEntries(snapshot);
  config.headers = headers;
  config.headers['X-Folder-Pins'] = JSON.stringify(obj);
  return config;
});

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

    // 423 is shared between session-lock and folder-lock responses. Only the
    // session-lock path drives the SessionLockScreen — folder locks bubble up
    // to the calling component so it can pop the per-folder PIN modal.
    if (status === 423 && onSessionLocked) {
      const errCode = error.response?.data?.error;
      if (errCode !== 'pin_required') {
        try { await onSessionLocked(); } catch {}
      }
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
