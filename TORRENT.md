# Torrent Downloading — Architecture

## Why a Separate Service?

WebTorrent depends on `node-datachannel`, a native addon that uses `import.meta.url` internally to resolve its binary path. **Bun's ESM loader leaves `import.meta.url` empty** when initialising native addons, causing a fatal `Cannot find module '...node_datachannel.node' from ''` error at runtime — regardless of how the package is installed or bundled.

Running the torrent code inside the main Bun process is therefore not viable without patching the upstream package. The clean solution is to isolate all WebTorrent logic in a standalone **Node.js microservice** that the main Bun app talks to over HTTP + WebSocket.

## Architecture

```
┌─────────────────────────────────┐        ┌──────────────────────────────┐
│  Truecloud (Bun — port 3000)    │        │  torrent-service (Node.js — port 9669) │
│                                 │        │                              │
│  Next.js API routes             │  HTTP  │  REST API                    │
│  app/api/files/torrent-download ├───────►│  POST   /downloads           │
│  app/api/files/test-tracker     │        │  GET    /downloads/active    │
│  app/api/files/route.js         │        │  GET    /downloads/waiting   │
│                                 │        │  PATCH  /downloads/:gid      │
│  lib/torrentClient.js           │        │  DELETE /downloads/:gid      │
│  (HTTP client — drop-in         │        │  GET    /tracker/test        │
│   replacement for               │        │                              │
│   webTorrentManager)            │        │  WebSocket /events           │
│                                 │   WS   │  → download-progress         │
│  server.js WS bridge ◄──────────┼────────┤  → download-complete         │
│  global.broadcastTorrentDownload│        │  → download-paused           │
│  Update → frontend clients      │        │  → download-resumed          │
└─────────────────────────────────┘        └──────────────────────────────┘
```

### Data flow

1. **User initiates download** → `POST /api/files/torrent-download` → `lib/torrentClient.js` → `POST http://localhost:9669/downloads`
2. **torrent-service** adds torrent to WebTorrent, returns `{ gid }` (the torrent info-hash)
3. **Progress events** — torrent-service broadcasts `download-progress` every second over its WebSocket at `ws://localhost:9669/events`
4. **server.js bridge** — a persistent WS client connects to the torrent-service on startup and forwards every event to all authenticated frontend clients via `global.broadcastTorrentDownloadUpdate`
5. **Frontend** receives events under the unified WebSocket type `torrent-downloads`

### Reconnection

The WS bridge in `server.js` auto-reconnects every 3 seconds if the torrent-service goes down, so a service restart doesn't require restarting the main app.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TORRENT_SERVICE_URL` | `http://localhost:9669` | Base URL of the torrent microservice (set same value in both services) |
| `TORRENT_SERVICE_PORT` | `9669` | Port the microservice listens on (torrent-service only) |
| `TORRENT_STATE_FILE` | `./torrent-downloads.json` | Path where download state is persisted across restarts |
| `UPLOAD_DIR` | `./uploads` | Absolute path to the files root — must match the main app |

## Running in Production

Both services are managed by systemd:

```bash
# torrent-service (must start first)
systemctl enable torrent-service
systemctl start torrent-service

# main app
systemctl enable truecloud
systemctl start truecloud
```

The `truecloud.service` unit declares `Wants=torrent-service.service` so systemd starts torrent-service automatically.

## Development

```bash
# Terminal 1 — torrent service (Node.js required, not Bun)
cd torrent-service
pnpm install
node index.mjs

# Terminal 2 — main app
cd Truecloud
bun dev
```

## Rebuilding the Native Binary

If `node-datachannel` fails to find its prebuilt binary (e.g. after a fresh clone or Node.js upgrade):

```bash
cd torrent-service
pnpm run rebuild-native
```

This runs `prebuild-install -r napi` against the installed `node-datachannel` package to fetch or compile the correct binary for the current Node.js ABI version.
