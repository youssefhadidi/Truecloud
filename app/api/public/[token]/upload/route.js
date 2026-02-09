/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink, open } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';

export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req, { params }) {
  let writtenFilePath = null;
  let fileHandle = null;
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');
    const subPath = url.searchParams.get('path') || '';

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Check if uploads are allowed
    if (!share.allowUploads) {
      return NextResponse.json({ error: 'Uploads not allowed for this share' }, { status: 403 });
    }

    // Uploads only work for directory shares
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Uploads only allowed for directory shares' }, { status: 400 });
    }

    // Validate the upload path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal
    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Ensure the target directory exists
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // File metadata comes from headers (body is raw binary, not multipart)
    const fileName = decodeURIComponent(req.headers.get('x-file-name') || '') || 'unknown';
    const mimeType = req.headers.get('content-type') || 'application/octet-stream';
    writtenFilePath = join(targetDir, fileName);

    if (!req.body) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Stream the raw body directly to disk — no multipart parsing needed
    const reader = req.body.getReader();
    fileHandle = await open(writtenFilePath, 'w');
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await fileHandle.write(value);
      size += value.length;
    }

    await fileHandle.close();
    fileHandle = null;
    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: fileName,
        size,
        mimeType,
      },
    });
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  } finally {
    // Close file handle if still open
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {}
    }
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
