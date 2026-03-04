const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');
const { startLogStream } = require('./lib/logStreamManager');
const fs = require('fs');
const path = require('path');

// Patch webrtc-polyfill synchronously before any ESM imports.
// webrtc-polyfill -> node-datachannel fails in Bun's ESM-CJS interop (__dirname='').
// We replace it with no-op stubs since WebRTC (browser peers) is not needed
// for server-side torrent downloads. The package.json override + bun install
// makes this permanent; this patch bridges the gap on restart.
(function patchWebrtcPolyfill() {
  const polyfillPath = path.join(__dirname, 'node_modules/webrtc-polyfill/index.js');
  try {
    if (!fs.existsSync(polyfillPath)) return;
    if (!fs.readFileSync(polyfillPath, 'utf8').includes('node-datachannel')) return;
    fs.writeFileSync(polyfillPath, [
      'export class RTCPeerConnection { constructor() {} createOffer() { return Promise.reject(); } createAnswer() { return Promise.reject(); } setLocalDescription() { return Promise.reject(); } setRemoteDescription() { return Promise.reject(); } addIceCandidate() { return Promise.reject(); } close() {} addEventListener() {} removeEventListener() {} }',
      'export class RTCSessionDescription { constructor(d={}) { Object.assign(this,d); } }',
      'export class RTCIceCandidate { constructor(d={}) { Object.assign(this,d); } }',
      'export class RTCIceTransport {}',
      'export class RTCDataChannel {}',
      'export class RTCSctpTransport {}',
      'export class RTCDtlsTransport {}',
      'export class RTCCertificate {}',
      'export class MediaStream { getTracks() { return []; } }',
      'export default {};',
    ].join('\n'));
    console.log('> Patched webrtc-polyfill stub (run bun install to make permanent)');
  } catch (e) {
    console.error('> webrtc-polyfill patch failed:', e.message);
  }
}());

// Dynamic imports for ES modules
let getToken;
let verifyShare;

async function loadEsModules() {
  const nextAuth = await import('next-auth/jwt');
  getToken = nextAuth.getToken;

  const shareAuth = await import('./lib/shareAuth.mjs');
  verifyShare = shareAuth.verifyShare;

  // Load WebTorrent manager before server starts so the native node-datachannel addon
  // is resolved in Bun's unbundled context. global.torrentManager is ready for all requests.
  try {
    globalThis.torrentManager = await import('./lib/webTorrentManager.js');
    console.log('> WebTorrent manager ready');
  } catch (err) {
    console.error('> WebTorrent manager failed to load:', err.stack || err);
  }
}

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
  // Mirror into the generic job manager (lazy import to avoid CJS/ESM issues at startup)
  import('./lib/jobManager.js').then(({ syncCacheJobToManager }) => {
    syncCacheJobToManager(global.cacheGenerationStatus);
  }).catch(() => {});
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

global.broadcastFileIndexUpdate = (message) => {
  broadcastMessage({ type: 'file-index', payload: message });
};

// Minecraft: broadcast console lines and status changes
global.minecraftProcesses = new Map();

global.broadcastMinecraftConsole = (serverId, lines) => {
  broadcastMessage({ type: 'minecraft-console', payload: { serverId, lines } });
};

global.broadcastMinecraftStatus = (serverId, status) => {
  broadcastMessage({ type: 'minecraft-status', payload: { serverId, status } });
};

global.broadcastJobUpdate = (job) => {
  broadcastMessage({ type: 'job-status', payload: job });
};

// Load ES modules before starting server
loadEsModules().then(() => {
  app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Authenticate WebSocket upgrade requests
  async function authenticateWsUpgrade(request) {
    // 1. Check NextAuth session via getToken (same approach as pages/api/files/upload.js)
    try {
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
        ws.isAlive = true;
        wsClients.add(ws);

        ws.send(JSON.stringify({
          type: 'update-status',
          payload: global.updateStatus,
        }));

        ws.send(JSON.stringify({
          type: 'cache-generation',
          payload: global.cacheGenerationStatus,
        }));

        import('./lib/jobManager.js').then(({ listJobs }) => {
          ws.send(JSON.stringify({ type: 'job-list', payload: listJobs() }));
        }).catch(() => {});

        ws.on('pong', () => {
          ws.isAlive = true;
        });

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

  // Heartbeat: ping all clients every 30 s so proxies don't close idle connections.
  // Clients that never respond with a pong are terminated (dead connections).
  const heartbeatInterval = setInterval(() => {
    wsClients.forEach((ws) => {
      if (ws.isAlive === false) {
        wsClients.delete(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');

    // Start log stream manager
    startLogStream();

    // Start file watcher for search index
    import('./lib/fileWatcher.mjs').then(({ startFileWatcher }) => startFileWatcher());

    // Auto-start Minecraft servers that have autoStart = true
    import('./lib/minecraft.js').then(async ({ spawnServer }) => {
      try {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = global.prisma || new PrismaClient();
        const autoStartServers = await prisma.minecraftServer.findMany({
          where: { autoStart: true },
        });
        for (const server of autoStartServers) {
          spawnServer(server, prisma).catch((err) => {
            console.error(`[Minecraft] Failed to auto-start ${server.name}:`, err.message);
          });
        }
      } catch (err) {
        console.error('[Minecraft] Auto-start failed:', err.message);
      }
    });
  });

  server.on('close', () => clearInterval(heartbeatInterval));
  });
});
