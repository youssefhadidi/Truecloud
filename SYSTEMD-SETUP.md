<!-- @format -->

# Truecloud Systemd Service Setup

This guide explains how to set up Truecloud to run automatically on boot using systemd.

## Prerequisites

- Debian-based Linux system
- Node.js and pnpm installed
- Application already built (`pnpm build`)

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
