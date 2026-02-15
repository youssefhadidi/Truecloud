const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');
const { startLogStream } = require('./lib/logStreamManager');

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

global.broadcastLogs = (message) => {
  broadcastMessage({ type: 'logs', payload: message });
};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Authenticate WebSocket upgrade requests
  async function authenticateWsUpgrade(request) {
    // 1. Check NextAuth session via getToken (same approach as pages/api/files/upload.js)
    try {
      const { getToken } = await import('next-auth/jwt');
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      if (token) return true;
    } catch {
      // No valid session, continue to share check
    }

    // 2. Check share token + password query params
    const url = new URL(request.url, `http://${request.headers.host}`);
    const shareToken = url.searchParams.get('token');
    const sharePassword = url.searchParams.get('password');

    if (shareToken && sharePassword) {
      try {
        const { verifyShare } = await import('./lib/shareAuth.js');
        const result = await verifyShare(shareToken, sharePassword);
        if (result.valid) return true;
      } catch {
        // Share verification failed
      }
    }

    return false;
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname !== '/api/ws') {
      socket.destroy();
      return;
    }

    authenticateWsUpgrade(request).then((authenticated) => {
      if (!authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wsClients.add(ws);

        ws.send(JSON.stringify({
          type: 'update-status',
          payload: global.updateStatus,
        }));

        ws.send(JSON.stringify({
          type: 'cache-generation',
          payload: global.cacheGenerationStatus,
        }));

        ws.on('close', () => {
          wsClients.delete(ws);
        });

        ws.on('error', () => {
          wsClients.delete(ws);
        });
      });
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');

    // Start log stream manager
    startLogStream();
  });
});
