<!-- @format -->

# Quick Setup Guide

## 1. Generate NextAuth Secret

Run this command and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then paste it into `.env.local` as `NEXTAUTH_SECRET=<your-generated-secret>`

## 2. Configure Environment Variables

Edit `.env.local` and set:

```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="<your-generated-secret-from-step-1>"
NEXTAUTH_URL="http://localhost:3000"

# Optional: TrueNAS Configuration
TRUENAS_HOST="192.168.1.100"
TRUENAS_SHARE="myshare"
TRUENAS_USERNAME="admin"
TRUENAS_PASSWORD="yourpassword"
TRUENAS_DOMAIN="WORKGROUP"

# File Storage
UPLOAD_DIR="./uploads"
```

## 3. Initialize Database

```bash
pnpm run setup
```

This will:

- Generate Prisma client
- Create database tables

## 4. Create First Admin User

Option 1 - Use the script:

```bash
pnpm run create-admin
```

## 5. Start Development Server

```bash
pnpm dev
```

Open http://localhost:3000

## 6. Install FFmpeg (Optional, for video thumbnails)

### Windows

1. Download from https://ffmpeg.org/download.html
2. Extract and add to PATH

### Linux

```bash
sudo apt install ffmpeg
```

### macOS

```bash
brew install ffmpeg
```

## Troubleshooting

### Database Issues

```bash
# Reset database
rm prisma/dev.db
pnpm run setup
```

### Module Errors

```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### Port Already in Use

```bash
# Use different port
PORT=3001 pnpm dev
```

## Production Deployment

1. Use PostgreSQL instead of SQLite:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/truecloud"
```

2. Build the app:

```bash
pnpm build
```

3. Start production server:

```bash
pnpm start
```

## Features to Try

1. Upload an image - see automatic thumbnail
2. Upload a video - see thumbnail and streaming playback
3. Share files with other users (create permissions)
4. Download files
5. Delete files

## Security Notes

- Change `NEXTAUTH_SECRET` in production
- Use strong passwords
- Consider using HTTPS in production
- Regularly backup your database
- Review file permissions regularly
