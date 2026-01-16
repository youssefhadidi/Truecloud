<!-- @format -->

# Docker Deployment Guide for TrueNAS

## Prerequisites

1. TrueNAS VM with Docker installed
2. TrueNAS dataset created (e.g., `tank/truecloud`)
3. Dataset mounted in your VM

## Setup Steps

### 1. Create TrueNAS Dataset Structure

On TrueNAS, create a dataset:

```bash
# On TrueNAS
zfs create tank/truecloud
zfs create tank/truecloud/files
zfs create tank/truecloud/db
```

### 2. Mount Dataset in VM

In your TrueNAS VM, ensure the dataset is mounted:

```bash
# Check if mounted
df -h | grep truecloud

# If not mounted, mount it (example for NFS)
mkdir -p /mnt/tank/truecloud
mount -t nfs truenas-ip:/mnt/tank/truecloud /mnt/tank/truecloud
```

Or add to `/etc/fstab` for permanent mount:

```
truenas-ip:/mnt/tank/truecloud  /mnt/tank/truecloud  nfs  defaults  0  0
```

### 3. Configure Environment Variables

Edit `.env.local`:

```env
DATABASE_URL="file:/data/db/truecloud.db"
NEXTAUTH_SECRET="your-generated-secret"
NEXTAUTH_URL="http://your-truenas-ip:3000"
STORAGE_MODE="direct"
UPLOAD_DIR="/data/files"
```

### 4. Update docker-compose.yml

Edit the volume paths to match your TrueNAS dataset location:

```yaml
volumes:
  - /mnt/tank/truecloud/files:/data/files
  - /mnt/tank/truecloud/db:/data/db
```

### 5. Build and Run

```bash
# Build the Docker image
docker-compose build

# Start the container
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 6. Initialize Database

```bash
# Run database setup inside container
docker-compose exec truecloud pnpm run setup

# Create admin user
docker-compose exec truecloud pnpm run create-admin
```

## Performance Benefits

Using direct mounts instead of SMB:

- **Lower Latency**: No network protocol overhead
- **Better Throughput**: Direct filesystem I/O
- **Less CPU**: No SMB encryption/decryption
- **Simplified**: No credential management

## Volume Permissions

Ensure the container has permission to write to mounted volumes:

```bash
# On the VM host
sudo chown -R 1000:1000 /mnt/tank/truecloud
sudo chmod -R 755 /mnt/tank/truecloud
```

## Alternative: Passthrough Mount

For even better performance, you can use TrueNAS VM passthrough:

1. In TrueNAS VM settings, add the dataset as a device
2. Mount directly in the VM without NFS
3. Point docker-compose volumes to the local mount

## Monitoring

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f truecloud

# Check disk usage
df -h /mnt/tank/truecloud

# Restart container
docker-compose restart

# Stop container
docker-compose down
```

## Backup Strategy

Since files are on TrueNAS dataset:

- Use TrueNAS snapshots for point-in-time recovery
- Set up replication to another TrueNAS system
- Regular ZFS snapshots protect both database and files

## Troubleshooting

### Permission Denied

```bash
# Fix permissions
docker-compose exec truecloud chown -R node:node /data
```

### Database Locked

```bash
# Ensure only one instance is running
docker-compose down
docker-compose up -d
```

### Files Not Appearing

```bash
# Verify mount inside container
docker-compose exec truecloud ls -la /data/files
```
