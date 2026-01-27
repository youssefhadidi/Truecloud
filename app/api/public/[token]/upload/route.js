/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep, extname } from 'node:path';

export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HEIC_DIR = './heic';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const RESOLVED_HEIC_DIR = resolve(process.cwd(), HEIC_DIR) + sep;

export async function POST(req, { params }) {
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

    // Parse form data
    let formData;
    try {
      formData = await req.formData();
    } catch (parseError) {
      return NextResponse.json({ error: 'Invalid FormData format' }, { status: 400 });
    }

    const file = formData.get('file');
    const subPath = formData.get('path') || '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate the upload path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Check file extension for HEIC
    const fileExt = extname(file.name).toLowerCase();
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
    if (!existsSync(baseDir)) {
      await mkdir(baseDir, { recursive: true });
    }
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Read file data
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save file
    const filePath = join(targetDir, file.name);
    await writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
    });
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
