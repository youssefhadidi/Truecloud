/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import formidable from 'formidable';

export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req, { params }) {
  let writtenFilePath = null;
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

    if (!req.body) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Parse multipart FormData via formidable — streams file directly to disk
    const form = formidable({
      uploadDir: targetDir,
      keepExtensions: true,
      multiples: false,
    });

    const [, files] = await form.parse(req);
    const uploadedFiles = files.file;

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const uploadedFile = uploadedFiles[0];
    const fileName = uploadedFile.originalFilename || 'unknown';
    writtenFilePath = uploadedFile.filepath;
    const size = uploadedFile.size;
    const mimeType = uploadedFile.mimetype || 'application/octet-stream';

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
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
