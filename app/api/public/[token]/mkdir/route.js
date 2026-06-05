/** @format */

import { NextResponse } from 'next/server';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath, clientIpFromHeaders } from '@/lib/shareAuth';
import { logger } from '@/lib/logger';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req, { params }) {
  const startTime = Date.now();
  try {
    logger.info('POST /api/public/[token]/mkdir - Request received');

    const { token } = await params;
    const password = req.headers.get('x-share-password');
    const body = await req.json();
    const { name, path: subPath = '' } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    // Validate folder name - no path traversal
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 });
    }

    // Verify share and password
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));
    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Check if uploads are allowed
    if (!share.allowEditing) {
      return NextResponse.json({ error: 'Folder creation not allowed for this share' }, { status: 403 });
    }

    // Check if it's a directory share
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Cannot create folders in file shares' }, { status: 400 });
    }

    // Validate path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Construct full folder path
    const folderPath = join(UPLOAD_DIR, pathCheck.fullPath, name);
    const resolvedFolderPath = resolve(folderPath) + sep;

    // Security: ensure folder path is within upload directory
    if (!resolvedFolderPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/public/[token]/mkdir - Path traversal attempt', { folderPath, token });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if folder already exists
    if (existsSync(folderPath)) {
      return NextResponse.json({ error: 'Folder already exists' }, { status: 409 });
    }

    // Create folder
    await mkdir(folderPath, { recursive: false });

    // Broadcast file change to all connected clients
    broadcastFileChange('create', pathCheck.fullPath, name, `T-${token}`);

    logger.info('POST /api/public/[token]/mkdir - Folder created', {
      token,
      folderName: name,
      subPath,
      duration: `${Date.now() - startTime}ms`,
    });

    return NextResponse.json({ success: true, folderName: name });
  } catch (error) {
    logger.error('POST /api/public/[token]/mkdir - Error', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
