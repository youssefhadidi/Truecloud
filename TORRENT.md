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
│                                 │        │  → download-removed          │
│                                 │        │  → downloads-status          │
└─────────────────────────────────┘        └──────────────────────────────┘
```

### Completed downloads

A finished download is **kept** as history (`GET /downloads/completed`) instead of
being forgotten, because the clients that care about a completion are not
necessarily connected when it happens. The history is bounded
(`TORRENT_COMPLETED_HISTORY`, default 100), persisted with the rest of the state,
and dismissed explicitly — per entry via `DELETE /downloads/:gid`, or wholesale
via `DELETE /downloads/completed`.

Deleting is not one behaviour:

| Download state | `DELETE /downloads/:gid` does |
|---|---|
| complete | drops the history row; **files are kept** |
| active | removes the torrent with `destroyStore: true` — **partial data is deleted** |
| paused | unlinks `${dir}/${name}` after checking it resolves inside `dir` |

Completed entries are returned by `GET /api/files/torrent-download` (for the
downloads page) but deliberately **not** by `GET /api/files`, and `useFilesPage`
filters out any that reach it over the WebSocket — otherwise the placeholder row
would sit next to the real file it just produced.

Every event carries the finished record, so `download-complete` is enough on its
own to render a named row. A client connecting to `/events` is also sent a
`downloads-status` snapshot of the current state, which closes the gap where the
bridge's 3-second reconnect used to drop completions on the floor.

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
| `TORRENT_SERVICE_PATH` | `../torrent-service` | Path to the torrent-service git checkout, used by the admin update check |
| `TORRENT_SERVICE_PM` | `bun` | Package manager (or absolute path to it) the admin update installs with |
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
# Terminal 1 — torrent service. Install with anything; RUN with node, not bun.
cd torrent-service
bun install
node index.mjs

# Terminal 2 — main app
cd Truecloud
bun dev
```

## Updates

torrent-service is a **separate git repo** (`youssefhadidi/torrent-service`), so it
updates independently of the main app.

- **Checking** — `GET /api/system/check-updates` inspects both checkouts and returns
  the torrent-service result under `torrentService`. Its `package.json` version is
  pinned, so an update is any commit the remote is ahead by (`commitsBehind`), not a
  semver bump. If the checkout can't be located, `torrentService.available` is `false`
  and the main app's result is still returned as normal.
- **Applying** — `POST /api/system/run-update` with `{ "target": "torrent-service" }`
  runs stash → pull → install → native rebuild → `systemctl restart torrent-service`.
  Omit `target` (or send `"app"`) for the main app's update. Only one update may run
  at a time; a second request gets a `409`.
- **Package manager** — always **bun**, matching the main app. Only the
  *install* is bun's: `ExecStart` must stay `node index.mjs` no matter what
  installs the deps. `TORRENT_SERVICE_PM` overrides, and takes an absolute path
  (`/root/.bun/bin/bun`) for when bun isn't on the service's `PATH`.
- **Native rebuild** — `bun pm trust <names>`; bun has no `rebuild` command. The
  names come from the top-level `trustedDependencies` in torrent-service's
  `package.json`, falling back to `node-datachannel`.
  (`pnpm.onlyBuiltDependencies` is declared alongside it so an override to pnpm
  still builds, where the step becomes `<pm> rebuild node-datachannel`.)

  **Never `--all`.** It runs lifecycle scripts for every dependency that has
  one, and WebTorrent pulls in `ip-set`, whose preinstall is an `only-allow
  pnpm` guard that exits 1 under bun. The step dies there — before
  node-datachannel is rebuilt — and the service then starts on an unbuilt
  addon.
- **UI** — Admin → System Health has a dedicated *Update Torrent Service* button next
  to *Start Update*, and the update toast offers each one separately.

Locate the checkout with `TORRENT_SERVICE_PATH`; it otherwise defaults to a sibling
directory of the main app.

## Rebuilding the Native Binary

If `node-datachannel` fails to find its prebuilt binary (e.g. after a fresh clone or Node.js upgrade):

```bash
cd torrent-service
bun pm trust node-datachannel    # bun; or `npm rebuild node-datachannel`
```

This re-runs `node-datachannel`'s install script (`prebuild-install -r napi`) to
fetch or compile the correct binary for the current Node.js ABI version.

The repo's `rebuild-native` script does the same thing, but resolves
`node-datachannel` from the project root — fine under bun/npm, broken under
pnpm, where it's a transitive dep of `webtorrent`. Prefer the commands above.
