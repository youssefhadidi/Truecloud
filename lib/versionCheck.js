/** @format */

/**
 * Manually clear all caches and reload (escape hatch — call from browser console)
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
