<!-- @format -->

# Truecloud Systemd Service Setup

This guide explains how to set up Truecloud to run automatically on boot using systemd.

## Prerequisites

- Debian-based Linux system
- **Bun 1.4.0 or newer** — hard requirement, see [Runtime requirement](#runtime-requirement-bun-140) below
- Application already built (`bun run build`)

> **Note:** the steps below still reference `pnpm`, but the shipped
> `truecloud.service` runs `/root/.bun/bin/bun server.js` and the in-app
> updater installs with `bun install`. Bun is the supported runtime.

## Runtime requirement: Bun 1.4.0+

`server.js` loads the WebSocket library from `./node_modules/ws` by path rather
than letting the runtime resolve `ws`, because Bun ships a builtin `ws` that
shadows `node_modules` entirely. That builtin's `noServer` handshake path is
broken as of Bun 1.4.0 — every `/api/ws` upgrade dies before the 101 is
written — so the vendored copy is required there.

The reverse also holds: the vendored copy does **not** work on Bun 1.3.x, where
real `ws` cannot complete the handshake over Bun's `node:http` upgrade socket.
Running 1.3.x breaks all WebSocket traffic — live logs, torrent progress,
file-change events, update status.

**Every instance must run Bun ≥ 1.4.0.** Instances on different Bun versions
will not behave the same. Check with:

```bash
/root/.bun/bin/bun --version
```

Upgrade to latest, or pin an exact version to keep instances identical:

```bash
sudo -i
/root/.bun/bin/bun upgrade
# or pin (also the rollback command):
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"
```

Run this as **root** — the binary lives in `/root/.bun`, and `bun upgrade` as
another user updates that user's copy while the service keeps running the old one.

After any Bun upgrade, rebuild native bindings before restarting:

```bash
cd /home/truecloud/Truecloud
bun install
SHARP_FORCE_GLOBAL_LIBVIPS=1 bun pm trust --all
bun run db:generate && bun run build
systemctl restart truecloud
```

### Verifying

The startup banner records the runtime and which `ws` was loaded:

```bash
grep -F '[server] v' /var/log/truecloud/output.log | tail -1
```

```
[server] v1.319.0 | runtime=bun 1.4.0 | ws=vendored | NODE_ENV=production | ...
```

- `ws=vendored` — correct.
- `ws=runtime-builtin` — `node_modules/ws` is missing and the app silently fell
  back to Bun's builtin. WebSocket upgrades will fail on 1.4.x. Run `bun install`.

## Installation Steps

### 1. Configure the Service File

Edit `truecloud.service` and update the following placeholders:

- `your-username` → Your Linux username (e.g., `debian`, `ubuntu`, or your user)
- `/path/to/Truecloud` → Absolute path to your Truecloud directory
- `/usr/bin/pnpm` → Path to pnpm (find with `which pnpm`)

### 2. Create Log Directory

```bash
sudo mkdir -p /var/log/truecloud
sudo chown your-username:your-username /var/log/truecloud
```

### 3. Build the Application

```bash
cd /path/to/Truecloud
pnpm install
pnpm build
```

### 4. Install the Service

```bash
# Copy service file to systemd directory
sudo cp truecloud.service /etc/systemd/system/

# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable truecloud.service

# Start the service now
sudo systemctl start truecloud.service
```

## Service Management

### Check Service Status

```bash
sudo systemctl status truecloud
```

### View Logs

```bash
# Real-time logs
sudo journalctl -u truecloud -f

# Last 100 lines
sudo journalctl -u truecloud -n 100

# Application logs
tail -f /var/log/truecloud/output.log
tail -f /var/log/truecloud/error.log
```

### Stop Service

```bash
sudo systemctl stop truecloud
```

### Restart Service

```bash
sudo systemctl restart truecloud
```

### Disable Auto-Start

```bash
sudo systemctl disable truecloud
```

## Environment Variables

Add additional environment variables in the service file:

```ini
Environment="DATABASE_URL=postgresql://..."
Environment="NEXTAUTH_SECRET=your-secret"
Environment="NEXTAUTH_URL=http://your-domain.com"
```

## Troubleshooting

### Service Fails to Start

1. Check logs: `sudo journalctl -u truecloud -n 50`
2. Verify paths in service file are correct
3. Ensure application builds successfully
4. Check file permissions

### Port Already in Use

Change the PORT environment variable in the service file:

```ini
Environment="PORT=3001"
```

### Permission Issues

Ensure your user has read/write access to:

- Application directory
- `uploads/` directory
- `thumbnails/` directory
- Log directory (`/var/log/truecloud/`)

## Security Notes

The service file includes security hardening:

- `NoNewPrivileges=true` - Prevents privilege escalation
- `PrivateTmp=true` - Isolated /tmp directory
- `ProtectSystem=strict` - Read-only system directories
- `ProtectHome=read-only` - Read-only home directory
- `ReadWritePaths` - Explicitly allows writing to uploads/thumbnails

Adjust these settings based on your security requirements.

## Updating the Application

When you update your code:

```bash
cd /path/to/Truecloud
git pull
pnpm install
pnpm build
sudo systemctl restart truecloud
```
