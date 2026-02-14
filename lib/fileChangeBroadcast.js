/**
 * File change broadcast helper
 *
 * Centralizes broadcasting file changes to all connected WebSocket clients.
 * Enables real-time cache invalidation on the frontend.
 */

export function broadcastFileChange(operation, path, fileName, userId) {
  if (!global.broadcastFileChange) {
    console.warn('[FILE CHANGE] Broadcast function not available');
    return;
  }

  const message = {
    type: 'file-change',
    operation,      // 'create' | 'upload' | 'delete' | 'rename' | 'restore' | 'move'
    path,           // Relative path where the change occurred
    fileName,       // Name of the file/folder that changed
    userId,         // User ID who performed the action
    timestamp: new Date().toISOString(),
  };

  global.broadcastFileChange(message);
}
