<!-- @format -->

# truecloud - File Management System

A secure file management system for TrueNAS with user authentication, ACLs, thumbnails, and video streaming.

## Features

- 🔐 User authentication with NextAuth.js
- 📁 File upload, download, and management
- 🖼️ Image thumbnails
- 🎬 Video thumbnails and streaming
- 👥 User accounts and permissions (ACLs)
- 🔒 Secure file access control
- 📱 Responsive UI

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Set up environment variables:
   Edit `.env.local` and configure:

- `DATABASE_URL` - SQLite database path
- `NEXTAUTH_SECRET` - Secret for NextAuth (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` - Your app URL (http://localhost:3000 for development)
- TrueNAS connection details (optional, for future integration)

3. Initialize the database:

```bash
npx prisma generate
npx prisma db push
```

4. Create first admin user:
   Use the register page to create your first user.

5. Run the development server:

```bash
pnpm dev
```

6. Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Register a new account at `/auth/register`
2. Login at `/auth/login`
3. Upload files from the dashboard
4. Click on video thumbnails to stream videos
5. Download files or delete them as needed

## File Permissions

Files have the following permission types:

- **Read**: View and download files
- **Write**: Modify files
- **Delete**: Delete files
- **Share**: Grant permissions to other users

File owners have full permissions by default.

## Tech Stack

- Next.js 16 (App Router)
- Prisma (SQLite)
- NextAuth.js
- Tailwind CSS
- Sharp (image processing)
- React Icons

## Note on Video Thumbnails

Video thumbnail generation requires FFmpeg to be installed on your system:

- **Windows**: Download from https://ffmpeg.org/download.html
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg`

## TrueNAS Integration

The app is designed to work with TrueNAS shares. Configure your TrueNAS connection in `.env.local`. The SMB client integration can be enhanced based on your specific TrueNAS setup.

## Security

- Passwords are hashed with bcrypt
- Session-based authentication with JWT
- File access controlled by ACLs
- Protected API routes

# or

pnpm dev

# or

bun dev

```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
```
