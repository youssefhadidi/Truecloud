/** @format */

import axios from '@/lib/axiosConfig';

/**
 * Client-side cache invalidation and version checking
 * Detects when server has a new version and forces page reload
 */

export function initVersionChecker() {
  let lastVersion = localStorage.getItem('app_version');

  // Check version every 5 minutes (reduced from 30s to decrease polling overhead)
  setInterval(() => {
    axios
      .head('/')
      .then((response) => {
        const newVersion = response.headers['x-app-version'];

        if (!lastVersion) {
          lastVersion = newVersion;
          localStorage.setItem('app_version', newVersion);
          return;
        }

        if (newVersion && newVersion !== lastVersion) {
          console.log('ℹ️ New app version detected, reloading to avoid stale-build navigation issues.', {
            old: lastVersion,
            new: newVersion,
          });

          localStorage.setItem('app_version', newVersion);
          window.location.reload();
        }
      })
      .catch((error) => {
        console.debug('Version check failed (offline?):', error.message);
      });
  }, 5 * 60 * 1000); // Check every 5 minutes
}

/**
 * Manually clear all caches and reload
 */
export async function clearAllCachesAndReload() {
  try {
    // Clear localStorage
    localStorage.clear();

    // Clear sessionStorage
    sessionStorage.clear();

    // Clear service worker cache
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    // Force reload
    window.location.reload(true);
  } catch (error) {
    console.error('Error clearing caches:', error);
    window.location.reload();
  }
}
