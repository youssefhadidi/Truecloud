const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Unified WebSocket clients set - all messages route through here
const wsClients = new Set();

// Global update status state
global.updateStatus = {
  isRunning: false,
  currentStep: null,
  steps: [
    { name: 'pull', label: 'Pulling latest code', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'install', label: 'Installing dependencies', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'db_push', label: 'Updating database', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'build', label: 'Building application', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'restart', label: 'Restarting service', status: 'pending', startTime: null, endTime: null, logs: [] },
  ],
  startTime: null,
  endTime: null,
  success: null,
  error: null,
  logs: [],
};

// Global cache generation status state
global.cacheGenerationStatus = {
  isRunning: false,
  type: null,
  processed: 0,
  total: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  currentFile: null,
  startTime: null,
  endTime: null,
  success: null,
  error: null,
  duration: 0,
};

/**
 * Unified WebSocket message broadcast function
 * All messages are routed through /api/ws with a `type` field:
 * - type: 'update-status' for system update progress
 * - type: 'cache-generation' for cache generation progress
 * - type: 'torrent-downloads' for torrent download updates
 * - type: 'file-change' for file CRUD operations
 */
const broadcastMessage = (message) => {
  wsClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(message));
    }
  });
};

// Legacy function names for backwards compatibility during transition
global.broadcastUpdate = (message) => {
  broadcastMessage({ type: 'update-status', payload: message.payload });
};

global.broadcastCacheGenerationUpdate = (message) => {
  broadcastMessage({ type: 'cache-generation', payload: message.payload });
};

global.broadcastTorrentDownloadUpdate = (message) => {
  // Message is already in format { type: 'download-progress', payload: ... }
  // Wrap it under torrent-downloads type for unified WebSocket
  broadcastMessage({ type: 'torrent-downloads', payload: message });
};

global.broadcastFileChange = (message) => {
  broadcastMessage({ type: 'file-change', payload: message });
};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Unified WebSocket endpoint for all message types
    if (url.pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Add client to unified set
        wsClients.add(ws);

        // Send initial status messages to newly connected client
        // This ensures the client has current state for all message types
        ws.send(JSON.stringify({
          type: 'update-status',
          payload: global.updateStatus,
        }));

        ws.send(JSON.stringify({
          type: 'cache-generation',
          payload: global.cacheGenerationStatus,
        }));

        // Remove client when disconnected or error
        ws.on('close', () => {
          wsClients.delete(ws);
        });

        ws.on('error', () => {
          wsClients.delete(ws);
        });
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');
  });
});
