/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, incrementShareAccess } from '@/lib/shareAuth';
import { join, resolve, sep } from 'node:path';
import { stat } from 'fs/promises';
import { lookup } from 'mime-types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET - Returns share metadata
export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    const verification = await verifyShare(token, password);

    if (!verification.valid) {
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
    const filePath = join(UPLOAD_DIR, share.path, share.fileName);
    const resolvedPath = resolve(filePath) + sep;

    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

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
      allowUploads: share.allowUploads || false,
    });
  } catch (error) {
    console.error('GET /api/public/[token] - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
