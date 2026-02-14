const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const updateClients = new Set();
const cacheGenerationClients = new Set();
const torrentDownloadClients = new Set();
const fileChangeClients = new Set();

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

// Function to broadcast updates to all connected clients
global.broadcastUpdate = (message) => {
  updateClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(message));
    }
  });
};

// Function to broadcast cache generation updates to all connected clients
global.broadcastCacheGenerationUpdate = (message) => {
  cacheGenerationClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(message));
    }
  });
};

// Function to broadcast torrent download updates to all connected clients
global.broadcastTorrentDownloadUpdate = (message) => {
  torrentDownloadClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(message));
    }
  });
};

// Function to broadcast file changes to all connected clients
global.broadcastFileChange = (message) => {
  fileChangeClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(message));
    }
  });
};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/api/ws/update-status') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Send current status to newly connected client
        ws.send(JSON.stringify({
          type: 'status',
          payload: global.updateStatus,
        }));

        // Add to clients set
        updateClients.add(ws);

        // Remove client when disconnected
        ws.on('close', () => {
          updateClients.delete(ws);
        });

        ws.on('error', () => {
          updateClients.delete(ws);
        });
      });
    } else if (url.pathname === '/api/ws/cache-generation') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Send current status to newly connected client
        ws.send(JSON.stringify({
          type: 'status',
          payload: global.cacheGenerationStatus,
        }));

        // Add to clients set
        cacheGenerationClients.add(ws);

        // Remove client when disconnected
        ws.on('close', () => {
          cacheGenerationClients.delete(ws);
        });

        ws.on('error', () => {
          cacheGenerationClients.delete(ws);
        });
      });
    } else if (url.pathname === '/api/ws/torrent-downloads') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Add to clients set
        torrentDownloadClients.add(ws);

        // Send initial "connected" message
        ws.send(JSON.stringify({
          type: 'connected',
          message: 'Connected to torrent download status stream',
        }));

        // Remove client when disconnected
        ws.on('close', () => {
          torrentDownloadClients.delete(ws);
        });

        ws.on('error', () => {
          torrentDownloadClients.delete(ws);
        });
      });
    } else if (url.pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Add to clients set
        fileChangeClients.add(ws);

        // Send initial "connected" message
        ws.send(JSON.stringify({
          type: 'connected',
          message: 'Connected to updates stream',
        }));

        // Remove client when disconnected
        ws.on('close', () => {
          fileChangeClients.delete(ws);
        });

        ws.on('error', () => {
          fileChangeClients.delete(ws);
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
