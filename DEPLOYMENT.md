# Deployment Guide

## Automated Deployment Script

### Quick Deployment

```bash
# Deploy from main branch
sudo ./scripts/deploy.sh

# Deploy from specific branch
sudo ./scripts/deploy.sh develop
```

The script will:
1. ✅ Fetch latest changes from git
2. ✅ Stash any uncommitted changes
3. ✅ Pull the code
4. ✅ Install dependencies
5. ✅ Build Next.js application
6. ✅ Restart the systemctl service

Logs are saved to `/var/log/truecloud/deploy.log`

### Manual Deployment

If you need to manually deploy:

```bash
cd /mnt/Truenas/Truecloud
git pull origin main
pnpm install
pnpm build
sudo systemctl restart truecloud.service
```

## Cache Busting Strategy

### How it Works

1. **Server-side Cache Control**
   - All pages: `Cache-Control: public, max-age=0, must-revalidate` (no caching)
   - Static assets (`/_next/`): `Cache-Control: public, max-age=31536000, immutable` (1-year cache)
   - Each response includes `X-App-Version` header with build ID

2. **Client-side Version Checking**
   - Browser checks `X-App-Version` header every 30 seconds
   - When a new version is detected:
     - Clears all localStorage, sessionStorage, and service worker caches
     - Reloads the page with the new version
     - Users get the fresh code automatically!

3. **Manual Cache Clear**
   - Call `clearAllCachesAndReload()` from browser console to force clear all caches

### Benefits

- ✅ Users automatically get new code after deployment
- ✅ No manual cache clearing needed
- ✅ Static assets are cached for performance
- ✅ HTML pages are never cached (always served fresh with version check)
- ✅ Seamless experience for end users

## Setting Up Webhook Deployment (Optional)

For GitHub webhook automatic deployment:

```bash
# 1. Create webhook receiver script
sudo nano /usr/local/bin/truecloud-deploy-webhook.sh
```

Add this content:

```bash
#!/bin/bash
cd /mnt/Truenas/Truecloud
/mnt/Truenas/Truecloud/scripts/deploy.sh main >> /var/log/truecloud/webhook.log 2>&1
```

Make it executable:

```bash
sudo chmod +x /usr/local/bin/truecloud-deploy-webhook.sh
```

Then set up a GitHub webhook pointing to your server's deploy endpoint.

## Monitoring Deployments

Check deployment status:

```bash
# View recent deployments
tail -f /var/log/truecloud/deploy.log

# Check service status
systemctl status truecloud.service

# View application logs
journalctl -u truecloud.service -n 100 --no-pager
```

## Troubleshooting

### Service won't start after deployment

```bash
# Check what's wrong
journalctl -u truecloud.service -n 50

# Check for build errors
cd /mnt/Truenas/Truecloud && pnpm build

# Check logs
tail -f /var/log/truecloud/output.log
```

### Clients still see old code

Clients should auto-reload within 30 seconds of your deployment. If not:

1. Hard refresh the browser: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Or manually call from browser console: `clearAllCachesAndReload()`

### Git pull fails

Check if you have uncommitted changes:

```bash
cd /mnt/Truenas/Truecloud
git status
git stash  # or git commit if you need to keep changes
```
