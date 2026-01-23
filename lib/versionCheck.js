/** @format */

/**
 * Client-side cache invalidation and version checking
 * Detects when server has a new version and forces page reload
 */

export function initVersionChecker() {
  let lastVersion = localStorage.getItem('app_version');

  // Check version every 30 seconds
  setInterval(() => {
    fetch('/', { method: 'HEAD' })
      .then((response) => {
        const newVersion = response.headers.get('X-App-Version');

        if (!lastVersion) {
          lastVersion = newVersion;
          localStorage.setItem('app_version', newVersion);
          return;
        }

        if (newVersion && newVersion !== lastVersion) {
          console.log('ℹ️ New version available. Please reload when convenient.', {
            old: lastVersion,
            new: newVersion,
          });

          lastVersion = newVersion;
          localStorage.setItem('app_version', newVersion);

          // Don't force reload - let user decide when to refresh
          // In the future, could trigger a notification instead
        }
      })
      .catch((error) => {
        console.debug('Version check failed (offline?):', error.message);
      });
  }, 30000); // Check every 30 seconds
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
