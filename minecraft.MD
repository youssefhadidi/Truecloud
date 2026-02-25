# Minecraft Server Manager

Truecloud can host and manage PaperMC Minecraft servers directly from the admin panel, with a live console, world import, and per-server configuration.

---

## Overview

- **Server type**: PaperMC (high-performance, plugin-compatible)
- **Process management**: Each server runs as a child process of the Truecloud Node.js server
- **Live console**: Server stdout/stderr is streamed to the browser in real time via WebSocket; commands are sent via stdin
- **World import**: Upload a ZIP file to replace the server's world data
- **Auto-start**: Servers can be configured to start automatically when Truecloud boots

---

## Requirements

Java 21 must be installed on the host machine:

```bash
sudo apt-get install openjdk-21-jre-headless
```

`unzip` is required for world imports:

```bash
sudo apt-get install unzip
```

Server directories are created under `/opt/minecraft-servers/`. The Truecloud process must have write access to that path:

```bash
sudo mkdir -p /opt/minecraft-servers
sudo chown $(whoami) /opt/minecraft-servers
```

---

## Enabling the Feature

1. Go to **Admin → Components**
2. Toggle **Minecraft Server Manager** to enabled
3. The **Minecraft** item appears in the admin sidebar

---

## Creating a Server

1. Go to **Admin → Minecraft**
2. Click **New Server**
3. Fill in:
   - **Name** — alphanumeric, hyphens and underscores only (e.g. `survival`). Also used as the directory name.
   - **Port** — default `25565`. Each server must use a unique port.
   - **PaperMC version** — enter a Minecraft version (e.g. `1.21.4`) or leave as `latest`
   - **Min / Max RAM** — in megabytes (e.g. 512 / 2048)
4. Click **Create Server**

On creation, Truecloud will:
- Create `/opt/minecraft-servers/<name>/`
- Download the PaperMC JAR from the official API
- Write `server.properties` with the configured port and sensible defaults
- Auto-accept the Minecraft EULA (`eula.txt`)

---

## Starting and Stopping

Use the **Start** / **Stop** buttons on the server detail panel.

- **Start** — spawns the Java process; status transitions `stopped → starting → running`
- **Stop** — sends the `stop` command to the server console; status transitions `running → stopping → stopped`

> Servers do not survive a Truecloud process restart unless **Auto-start** is enabled in Config.

---

## Live Console

The **Console** tab shows real-time server output. The last 200 lines are kept in memory and shown on page load (via `/api/admin/minecraft/servers/[id]/logs`). New lines stream in via WebSocket (`minecraft-console` message type).

To send a command, type it in the input field at the bottom and press **Send** or `Enter`. The command is sent to the server's stdin — the same as typing it in a terminal.

Example commands:
```
list                    # show online players
op <username>           # give a player operator status
difficulty hard         # change difficulty
time set day            # set time to day
```

---

## Configuration

The **Config** tab lets you change:

| Setting | Description |
|---------|-------------|
| Min / Max RAM | Java heap size in MB. Applied on next server start. |
| Auto-start | Automatically start this server when Truecloud boots. |
| MOTD | Message shown in the server list in the Minecraft client. |
| Max players | Maximum simultaneous connections. |
| Difficulty | `peaceful`, `easy`, `normal`, or `hard`. |
| Gamemode | `survival`, `creative`, `adventure`, or `spectator`. |
| PvP | Enable or disable player vs player combat. |
| Online mode | Verify players against Mojang's auth servers. Disable for offline/cracked clients. |

Click **Save Configuration** to write changes. A server restart is required for most `server.properties` changes to take effect.

---

## World Import

The **World** tab allows replacing the server's world with a ZIP file.

**ZIP format requirements:**
- The ZIP must contain a folder named `world` at the root level
- Example structure:
  ```
  my-world.zip
  └── world/
      ├── level.dat
      ├── region/
      └── ...
  ```

On import:
1. The server must be stopped
2. Existing `world/`, `world_nether/`, and `world_the_end/` directories are deleted
3. The ZIP is extracted into the server directory
4. Start the server to load the new world

---

## server.properties Reference

The full `server.properties` file lives at `/opt/minecraft-servers/<name>/server.properties`. Beyond the settings exposed in the UI, you can SSH into the host and edit it directly. Common settings not in the UI:

```properties
white-list=false            # enable whitelist
spawn-protection=16         # radius around spawn that non-ops can't build
view-distance=10            # chunk render distance
simulation-distance=10      # mob tick distance
max-world-size=29999984     # world border in blocks
```

After editing manually, restart the server for changes to take effect.

---

## Architecture

### Process Management

Each server is a Node.js `child_process.spawn('java', [...])` attached to the Truecloud process.

```
server.js
 └─ global.minecraftProcesses   Map<serverId, ChildProcess>
 └─ global.broadcastMinecraftConsole(serverId, lines)
 └─ global.broadcastMinecraftStatus(serverId, status)

lib/minecraft.js
 ├─ spawnServer(server, prisma)   → spawns process, wires stdout → WS broadcast
 ├─ stopServer(serverId, prisma)  → writes "stop\n" to stdin
 ├─ sendCommand(serverId, cmd)    → writes cmd + "\n" to stdin
 └─ getConsoleBuffer(serverId)    → returns last 200 lines (in-memory)
```

### WebSocket Message Types

| Type | Payload | Description |
|------|---------|-------------|
| `minecraft-console` | `{ serverId, lines: string[] }` | New stdout/stderr lines |
| `minecraft-status` | `{ serverId, status }` | Status change (starting/running/stopping/stopped) |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/minecraft/servers` | List all servers |
| POST | `/api/admin/minecraft/servers` | Create a server |
| GET | `/api/admin/minecraft/servers/[id]` | Get server + server.properties |
| PUT | `/api/admin/minecraft/servers/[id]` | Update RAM, autoStart, properties |
| DELETE | `/api/admin/minecraft/servers/[id]` | Delete server + directory |
| POST | `/api/admin/minecraft/servers/[id]/start` | Start the server process |
| POST | `/api/admin/minecraft/servers/[id]/stop` | Stop the server process |
| POST | `/api/admin/minecraft/servers/[id]/command` | Send a console command |
| POST | `/api/admin/minecraft/servers/[id]/world` | Import world ZIP |
| GET | `/api/admin/minecraft/servers/[id]/logs` | Get buffered console lines |

---

## Troubleshooting

**"Failed to download PaperMC"**
The host needs internet access to reach `api.papermc.io`. Check firewall rules.

**"java: command not found" / server exits immediately**
Java 21 is not installed or not in PATH. Run `java -version` to check.

**Port conflict**
Each server needs a unique port. Check with `ss -tlnp | grep 25565`.

**World import fails with "unzip not found"**
Install unzip: `sudo apt-get install unzip`

**Server stops when Truecloud restarts**
Enable **Auto-start** in the server's Config tab. On Truecloud boot, all servers with `autoStart = true` are spawned automatically.

**"Stop the server before deleting it"**
Send the stop command first and wait for the status to reach `stopped`.
