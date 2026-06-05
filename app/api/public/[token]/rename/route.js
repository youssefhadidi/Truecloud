/** @format */

import { NextResponse } from 'next/server';
import { rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath, clientIpFromHeaders } from '@/lib/shareAuth';
import { logger } from '@/lib/logger';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function PATCH(req, { params }) {
  const startTime = Date.now();
  try {
    logger.info('PATCH /api/public/[token]/rename - Request received');

    const { token } = await params;
    const password = req.headers.get('x-share-password');
    const body = await req.json();
    const { oldName, newName, path: subPath = '' } = body;

    if (!oldName || !newName) {
      return NextResponse.json({ error: 'Old and new names are required' }, { status: 400 });
    }

    if (typeof oldName !== 'string' || typeof newName !== 'string') {
      return NextResponse.json({ error: 'Invalid names' }, { status: 400 });
    }

    // Validate both names - no path traversal
    const isInvalidName = (n) => n.includes('/') || n.includes('\\') || n === '.' || n === '..';
    if (isInvalidName(oldName) || isInvalidName(newName)) {
      return NextResponse.json({ error: 'Invalid folder/file name' }, { status: 400 });
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

    // Check if renames are allowed
    if (!share.allowEditing) {
      return NextResponse.json({ error: 'Renames not allowed for this share' }, { status: 403 });
    }

    // Check if it's a directory share
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Cannot rename in file shares' }, { status: 400 });
    }

    // Validate path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Construct old and new paths
    const oldPath = join(UPLOAD_DIR, pathCheck.fullPath, oldName);
    const newPath = join(UPLOAD_DIR, pathCheck.fullPath, newName);
    const resolvedOldPath = resolve(oldPath) + sep;
    const resolvedNewPath = resolve(newPath) + sep;

    // Security: ensure both paths are within upload directory
    if (!resolvedOldPath.startsWith(RESOLVED_UPLOAD_DIR) || !resolvedNewPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('PATCH /api/public/[token]/rename - Path traversal attempt', {
        oldPath,
        newPath,
        token,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if old file exists
    if (!existsSync(oldPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if new name already exists
    if (existsSync(newPath)) {
      return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    }

    // Rename file
    await rename(oldPath, newPath);

    // Broadcast file change to all connected clients
    broadcastFileChange('rename', pathCheck.fullPath, newName, `T-${token}`);

    logger.info('PATCH /api/public/[token]/rename - File renamed', {
      oldName,
      newName,
      subPath,
      duration: `${Date.now() - startTime}ms`,
    });

    return NextResponse.json({ success: true, newName });
  } catch (error) {
    logger.error('PATCH /api/public/[token]/rename - Error', error);
    return NextResponse.json({ error: 'Failed to rename file' }, { status: 500 });
  }
}
