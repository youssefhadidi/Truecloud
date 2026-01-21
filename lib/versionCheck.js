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
          console.log('🔄 New version detected. Reloading...', {
            old: lastVersion,
            new: newVersion,
          });
          
          // Clear all caches
          localStorage.setItem('app_version', newVersion);
          
          // Clear service worker cache if available
          if ('caches' in window) {
            caches.keys().then((cacheNames) => {
              cacheNames.forEach((cacheName) => {
                caches.delete(cacheName);
              });
            });
          }
          
          // Reload page with cache bypass
          window.location.href = window.location.href.split('?')[0] + '?v=' + newVersion;
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
