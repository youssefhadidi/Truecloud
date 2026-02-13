const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const updateClients = new Set();

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

// Function to broadcast updates to all connected clients
global.broadcastUpdate = (message) => {
  updateClients.forEach((client) => {
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
    } else {
      socket.destroy();
    }
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');
  });
});
