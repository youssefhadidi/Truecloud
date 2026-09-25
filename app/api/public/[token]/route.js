/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, incrementShareAccess, clientIpFromHeaders, readShareEmail, validateSharePath, isWithinShare,
} from '@/lib/shareAuth';
import { join } from 'node:path';
import { stat } from 'fs/promises';
import { lookup } from 'mime-types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// GET - Returns share metadata
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      // Return 401 if password required
      if (verification.requiresPassword) {
        return NextResponse.json(
          {
            requiresPassword: true,
            fileName: verification.share?.fileName,
            isDirectory: verification.share?.isDirectory,
          },
          { status: 401 }
        );
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Get file stats
    const pathCheck = validateSharePath(share, '');
    if (!pathCheck.allowed || !(await isWithinShare(share, pathCheck.fullPath))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch (e) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Increment access count
    await incrementShareAccess(share.id);

    // Return share metadata
    return NextResponse.json({
      token: share.token,
      fileName: share.fileName,
      isDirectory: share.isDirectory,
      size: fileStats.size,
      mimeType: lookup(share.fileName) || 'application/octet-stream',
      ownerUsername: share.owner.username,
      createdAt: share.createdAt,
      allowEditing: share.allowEditing || false,
      privateUploads: share.privateUploads || false,
      uploaderEmail: share.privateUploads ? readShareEmail(req, token) : null,
    });
  } catch (error) {
    console.error('GET /api/public/[token] - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
