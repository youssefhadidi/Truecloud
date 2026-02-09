/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, rename, unlink, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import formidable from 'formidable';

export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = './heic';
const TEMP_DIR = resolve(process.cwd(), '.upload-tmp');
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const RESOLVED_HEIC_DIR = resolve(process.cwd(), HEIC_DIR) + sep;

/**
 * Move a file, falling back to copy+delete if cross-device (EXDEV)
 */
async function moveFile(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await copyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}

export async function POST(req, { params }) {
  let tempFilePath = null;
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');

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

    // Ensure directories exist
    for (const dir of [UPLOAD_DIR, HEIC_DIR, TEMP_DIR]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Convert Web Request body to Node.js stream for formidable (streams to disk, not RAM)
    const nodeStream = Readable.fromWeb(req.body);
    nodeStream.headers = Object.fromEntries(req.headers.entries());

    const form = formidable({
      uploadDir: TEMP_DIR,
      keepExtensions: true,
      maxFileSize: 200 * 1024 * 1024 * 1024, // 200 GB
      maxTotalFileSize: 200 * 1024 * 1024 * 1024,
      allowEmptyFiles: false,
      multiples: false,
    });

    let fields, files;
    try {
      [fields, files] = await form.parse(nodeStream);
    } catch (parseError) {
      return NextResponse.json({ error: 'Upload parsing failed', details: parseError.message }, { status: 400 });
    }

    const uploadedFile = files.file?.[0];
    const subPath = fields.path?.[0] || '';

    if (!uploadedFile) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    tempFilePath = uploadedFile.filepath;

    // Validate the upload path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Check file extension for HEIC
    const fileExt = extname(uploadedFile.originalFilename).toLowerCase();
    const isHeic = ['.heic', '.heif'].includes(fileExt);

    const baseDir = isHeic ? HEIC_DIR : UPLOAD_DIR;
    const resolvedBaseDir = isHeic ? RESOLVED_HEIC_DIR : RESOLVED_UPLOAD_DIR;

    // Build target directory
    const targetDir = join(baseDir, pathCheck.fullPath);
    const resolvedTarget = resolve(targetDir) + sep;

    // Security: prevent directory traversal
    if (!resolvedTarget.startsWith(resolvedBaseDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Ensure directories exist
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Move file from temp to final location (atomic on same filesystem)
    const filePath = join(targetDir, uploadedFile.originalFilename);
    await moveFile(tempFilePath, filePath);
    tempFilePath = null; // Successfully moved, no cleanup needed

    return NextResponse.json({
      success: true,
      file: {
        name: uploadedFile.originalFilename,
        size: uploadedFile.size,
        mimeType: uploadedFile.mimetype,
      },
    });
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  } finally {
    // Clean up temp file if it still exists (e.g. error after formidable wrote it)
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }
  }
}
