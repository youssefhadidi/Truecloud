// Cap native thread pools BEFORE sharp/libvips/libheif load. Under Bun, the
// combination of multiple concurrent HEIC decodes and libde265's internal
// OpenMP thread pool produces a deterministic native segfault (0x80000008).
// libvips reads VIPS_CONCURRENCY at load time; libde265/libheif honour
// OMP_NUM_THREADS. Both must be set before the sharp module is first required.
process.env.VIPS_CONCURRENCY = process.env.VIPS_CONCURRENCY || '1';
process.env.OMP_NUM_THREADS = process.env.OMP_NUM_THREADS || '1';

const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const next = require('next');
const { startLogStream, stopLogStream } = require('./lib/logStreamManager');


// Dynamic imports for ES modules
let getToken;
let verifyShare;

async function loadEsModules() {
  const nextAuth = await import('next-auth/jwt');
  getToken = nextAuth.getToken;

  const shareAuth = await import('./lib/shareAuth.mjs');
  verifyShare = shareAuth.verifyShare;

}

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Unified WebSocket clients set - all messages route through here
const wsClients = new Set();

// Per-user index for targeted broadcasts (AI chat streams, etc.). Share-token
// sockets are not indexed here; AI features are session-only.
const userWsClients = new Map();

function addUserWs(userId, ws) {
  if (!userId) return;
  let set = userWsClients.get(userId);
  if (!set) { set = new Set(); userWsClients.set(userId, set); }
  set.add(ws);
}

function removeUserWs(ws) {
  const userId = ws.userId;
  if (!userId) return;
  const set = userWsClients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) userWsClients.delete(userId);
}

global.broadcastToUser = (userId, message) => {
  const set = userWsClients.get(userId);
  if (!set) return;
  const frame = JSON.stringify(message);
  set.forEach((client) => {
    if (client.readyState === 1) client.send(frame);
  });
};

// Clients that have subscribed to system-metrics (opt-in polling)
const metricsSubscribers = new Set();

// Clients that have subscribed to the live logs stream (opt-in polling).
// The log file poller in logStreamManager only runs while this set is non-empty.
const logSubscribers = new Set();

// Global update status state
global.updateStatus = {
  isRunning: false,
  currentStep: null,
  steps: [
    { name: 'pull', label: 'Pulling latest code', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'install', label: 'Installing dependencies', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'rebuild', label: 'Rebuilding native modules', status: 'pending', startTime: null, endTime: null, logs: [] },
    { name: 'db_migrate', label: 'Running database migrations', status: 'pending', startTime: null, endTime: null, logs: [] },
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
  const frame = JSON.stringify({ type: 'logs', payload: message });
  logSubscribers.forEach((client) => {
    if (client.readyState === 1) {
      client.send(frame);
    }
  });
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

global.broadcastAppUpdated = () => {
  broadcastMessage({ type: 'app-updated', payload: { at: Date.now() } });
};

global.broadcastUsbDrives = (drives) => {
  broadcastMessage({ type: 'usb-drives', payload: drives });
};

global.broadcastSystemMetrics = (metrics) => {
  const message = JSON.stringify({ type: 'system-metrics', payload: metrics });
  metricsSubscribers.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
};

// Load ES modules before starting server
loadEsModules().then(() => {
  return app.prepare();
}).then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Authenticate WebSocket upgrade requests. Returns the authenticated userId
  // when a valid NextAuth session is present, or `'share'` for share-token
  // sessions (which don't have a user id but are allowed to connect for
  // generic broadcasts like file-change). Returns null when unauthenticated.
  async function authenticateWsUpgrade(request) {
    // 1. Check NextAuth session via getToken (same approach as pages/api/files/upload.js)
    try {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      if (token?.id) return { userId: token.id };
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
        if (result.valid) return { userId: null };
      } catch {
        // Share verification failed
      }
    }

    return null;
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname !== '/api/ws') {
      socket.destroy();
      return;
    }

    authenticateWsUpgrade(request).then((authResult) => {
      if (!authResult) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.isAlive = true;
        ws.userId = authResult.userId || null;
        wsClients.add(ws);
        addUserWs(ws.userId, ws);

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

        import('./lib/usbManager.js').then(({ getUsbDrives }) => {
          ws.send(JSON.stringify({ type: 'usb-drives', payload: getUsbDrives() }));
        }).catch(() => {});

        ws.on('pong', () => {
          ws.isAlive = true;
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.channel === 'system-metrics') {
              if (msg.type === 'subscribe') {
                metricsSubscribers.add(ws);
                if (metricsSubscribers.size === 1) {
                  import('./lib/metricsCollector.js').then(({ startMetricsCollector }) => startMetricsCollector());
                }
              } else if (msg.type === 'unsubscribe') {
                metricsSubscribers.delete(ws);
                if (metricsSubscribers.size === 0) {
                  import('./lib/metricsCollector.js').then(({ stopMetricsCollector }) => stopMetricsCollector());
                }
              }
            } else if (msg.channel === 'logs') {
              if (msg.type === 'subscribe') {
                logSubscribers.add(ws);
                if (logSubscribers.size === 1) startLogStream();
              } else if (msg.type === 'unsubscribe') {
                logSubscribers.delete(ws);
                if (logSubscribers.size === 0) stopLogStream();
              }
            }
          } catch {}
        });

        ws.on('close', () => {
          wsClients.delete(ws);
          removeUserWs(ws);
          if (metricsSubscribers.delete(ws) && metricsSubscribers.size === 0) {
            import('./lib/metricsCollector.js').then(({ stopMetricsCollector }) => stopMetricsCollector());
          }
          if (logSubscribers.delete(ws) && logSubscribers.size === 0) {
            stopLogStream();
          }
        });

        ws.on('error', () => {
          wsClients.delete(ws);
          removeUserWs(ws);
          if (metricsSubscribers.delete(ws) && metricsSubscribers.size === 0) {
            import('./lib/metricsCollector.js').then(({ stopMetricsCollector }) => stopMetricsCollector());
          }
          if (logSubscribers.delete(ws) && logSubscribers.size === 0) {
            stopLogStream();
          }
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
        removeUserWs(ws);
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

    // Bridge WebSocket events from the torrent microservice to main app WebSocket clients
    if (process.env.DISABLE_TORRENT_SERVICE !== '1') {
      const { WebSocket: WsClient } = require('ws');
      const torrentServiceBase = process.env.TORRENT_SERVICE_URL || 'http://localhost:9669';
      const torrentWsUrl = torrentServiceBase.replace(/^http/, 'ws') + '/events';
      function connectTorrentServiceWs() {
        const ws = new WsClient(torrentWsUrl);
        ws.on('open', () => console.log('[server] Connected to torrent service WS'));
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (global.broadcastTorrentDownloadUpdate) {
              global.broadcastTorrentDownloadUpdate(message);
            }
          } catch (_) {}
        });
        ws.on('close', () => {
          console.log('[server] Torrent service WS disconnected, reconnecting in 3s...');
          setTimeout(connectTorrentServiceWs, 3000);
        });
        ws.on('error', (err) => console.error('[server] Torrent service WS error:', err.message));
      }
      connectTorrentServiceWs();
    } else {
      console.log('[server] Torrent service WS bridge disabled (DISABLE_TORRENT_SERVICE=1)');
    }

    // Log stream is subscription-based; it starts on first WS subscriber.

    // Start file watcher for search index
    import('./lib/fileWatcher.mjs').then(({ startFileWatcher }) => startFileWatcher());

    // Start USB drive watcher (Linux only; no-op elsewhere)
    import('./lib/usbManager.js').then(({ startUsbManager }) => startUsbManager());

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
