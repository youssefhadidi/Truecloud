/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { lookup } from 'mime-types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET - List files in a shared directory
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Only directory shares can list files
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Not a directory share' }, { status: 400 });
    }

    // Get optional subPath for navigating within the shared directory
    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';

    // Validate the path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);
    const resolvedTarget = resolve(targetDir) + sep;

    // Security: prevent directory traversal
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Read files from filesystem
    let fileNames;
    try {
      fileNames = await readdir(targetDir);
    } catch (e) {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }

    // Get file stats for each file
    const files = await Promise.all(
      fileNames.map(async (name) => {
        const filePath = join(targetDir, name);
        const stats = await stat(filePath);

        return {
          id: name,
          name: name,
          size: stats.size,
          mimeType: lookup(name) || 'application/octet-stream',
          isDirectory: stats.isDirectory(),
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
        };
      })
    );

    // Sort: directories first, then by name
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      files,
      currentPath: subPath,
      shareName: share.fileName,
    });
  } catch (error) {
    console.error('GET /api/public/[token]/files - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
