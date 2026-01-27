/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import bcrypt from 'bcryptjs';
import { join, resolve, sep } from 'node:path';
import { stat } from 'fs/promises';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// GET - List all shares for current user
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const path = searchParams.get('path');
    const fileName = searchParams.get('fileName');

    // If path and fileName provided, return specific share
    if (path !== null && fileName) {
      const share = await prisma.share.findFirst({
        where: {
          path,
          fileName,
          ownerId: session.user.id,
        },
      });
      return NextResponse.json({ share });
    }

    // Otherwise, return all shares for user
    const shares = await prisma.share.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ shares });
  } catch (error) {
    console.error('GET /api/shares - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create a new share
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { path, fileName, isDirectory, password, expiresAt, allowUploads } = await req.json();

    if (!fileName) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 });
    }

    // Check user has access to this path
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: path || '',
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    const normalizedPath = accessCheck.normalizedPath;

    // Verify file/folder exists
    const targetPath = join(UPLOAD_DIR, normalizedPath, fileName);
    const resolvedTarget = resolve(targetPath) + sep;

    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    try {
      const stats = await stat(targetPath);
      // Verify isDirectory matches actual file type
      if (isDirectory !== stats.isDirectory()) {
        return NextResponse.json(
          { error: isDirectory ? 'Path is not a directory' : 'Path is a directory' },
          { status: 400 }
        );
      }
    } catch (e) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if share already exists for this path
    const existingShare = await prisma.share.findFirst({
      where: {
        path: normalizedPath,
        fileName,
        ownerId: session.user.id,
      },
    });

    if (existingShare) {
      // Return existing share
      const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      return NextResponse.json({
        share: existingShare,
        shareUrl: `${baseUrl}/s/${existingShare.token}`,
        existing: true,
      });
    }

    // Hash password if provided
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    // Create share
    const share = await prisma.share.create({
      data: {
        path: normalizedPath,
        fileName,
        isDirectory: isDirectory || false,
        ownerId: session.user.id,
        passwordHash,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        allowUploads: isDirectory ? (allowUploads || false) : false,
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';

    return NextResponse.json({
      share,
      shareUrl: `${baseUrl}/s/${share.token}`,
    });
  } catch (error) {
    console.error('POST /api/shares - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
