#!/bin/bash

# Deployment script for TrueCloud
# Usage: ./scripts/deploy.sh [branch] (default: main)

set -e

BRANCH=${1:-main}
APP_DIR="/mnt/Truenas/Truecloud"
SERVICE_NAME="truecloud.service"
LOG_FILE="/var/log/truecloud/deploy.log"

echo "========================================" | tee -a "$LOG_FILE"
echo "Deploying TrueCloud - $(date)" | tee -a "$LOG_FILE"
echo "Branch: $BRANCH" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Navigate to app directory
cd "$APP_DIR"

# Fetch latest changes
echo "[1/5] Fetching latest changes from git..." | tee -a "$LOG_FILE"
git fetch origin "$BRANCH" >> "$LOG_FILE" 2>&1

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "[WARNING] You have uncommitted changes. Stashing them..." | tee -a "$LOG_FILE"
    git stash >> "$LOG_FILE" 2>&1
fi

# Pull latest code
echo "[2/5] Pulling code from origin/$BRANCH..." | tee -a "$LOG_FILE"
git pull origin "$BRANCH" >> "$LOG_FILE" 2>&1

# Install dependencies
echo "[3/5] Installing dependencies..." | tee -a "$LOG_FILE"
pnpm install >> "$LOG_FILE" 2>&1

# Build Next.js
echo "[4/5] Building Next.js application..." | tee -a "$LOG_FILE"
pnpm build >> "$LOG_FILE" 2>&1

# Restart service
echo "[5/5] Restarting systemctl service..." | tee -a "$LOG_FILE"
systemctl restart "$SERVICE_NAME" >> "$LOG_FILE" 2>&1

# Check service status
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "✅ Service is running!" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "Deployment completed successfully!" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
else
    echo "❌ Service failed to start. Check logs:" | tee -a "$LOG_FILE"
    echo "  journalctl -u $SERVICE_NAME -n 50" | tee -a "$LOG_FILE"
    exit 1
fi
