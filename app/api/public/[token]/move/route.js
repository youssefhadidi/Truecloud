/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { join, resolve, sep } from 'node:path';
import { existsSync } from 'fs';
import { stat, rename } from 'fs/promises';
import { logger } from '@/lib/logger';
import { broadcastFileChange } from '@/lib/fileChangeBroadcast';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

const sanitizeName = (name) => {
  if (typeof name !== 'string') return '';
  return name.split(/[/\\]/).pop() || '';
};

export async function POST(req, { params }) {
  const startTime = Date.now();
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    const body = await req.json().catch(() => null);
    const items = Array.isArray(body?.items) ? body.items : [];
    const sourcePath = body?.sourcePath || '';
    const destinationPath = body?.destinationPath || '';

    if (items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const verification = await verifyShare(token, password);
    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;
    if (!share.allowUploads) {
      return NextResponse.json({ error: 'Uploads not allowed for this share' }, { status: 403 });
    }
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Uploads only allowed for directory shares' }, { status: 400 });
    }

    const safeNames = items.map(sanitizeName).filter(Boolean);
    if (safeNames.length !== items.length) {
      return NextResponse.json({ error: 'Invalid item names' }, { status: 400 });
    }

    const sourceCheck = validateSharePath(share, sourcePath);
    if (!sourceCheck.allowed) {
      return NextResponse.json({ error: sourceCheck.error }, { status: 400 });
    }

    const destCheck = validateSharePath(share, destinationPath);
    if (!destCheck.allowed) {
      return NextResponse.json({ error: destCheck.error }, { status: 400 });
    }

    if (sourceCheck.fullPath === destCheck.fullPath) {
      return NextResponse.json({ error: 'Destination matches source' }, { status: 400 });
    }

    const sourceDir = join(UPLOAD_DIR, sourceCheck.fullPath);
    const destDir = join(UPLOAD_DIR, destCheck.fullPath);

    const resolvedSourceDir = resolve(sourceDir) + sep;
    const resolvedDestDir = resolve(destDir) + sep;
    if (!resolvedSourceDir.startsWith(RESOLVED_UPLOAD_DIR) || !resolvedDestDir.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    let destStats;
    try {
      destStats = await stat(destDir);
    } catch {
      return NextResponse.json({ error: 'Destination folder not found' }, { status: 404 });
    }

    if (!destStats.isDirectory()) {
      return NextResponse.json({ error: 'Destination is not a folder' }, { status: 400 });
    }

    const normalizedSourcePath = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedDestPath = destinationPath.replace(/\\/g, '/').replace(/\/+$/, '');

    const missing = [];
    const conflicts = [];
    const invalidMoves = [];
    const movePlan = [];

    for (const name of safeNames) {
      const sourceItemPath = join(sourceDir, name);
      const destItemPath = join(destDir, name);

      const resolvedSourceItem = resolve(sourceItemPath) + sep;
      const resolvedDestItem = resolve(destItemPath) + sep;

      if (!resolvedSourceItem.startsWith(RESOLVED_UPLOAD_DIR) || !resolvedDestItem.startsWith(RESOLVED_UPLOAD_DIR)) {
        invalidMoves.push(name);
        continue;
      }

      let sourceStats;
      try {
        sourceStats = await stat(sourceItemPath);
      } catch {
        missing.push(name);
        continue;
      }

      if (sourceStats.isDirectory()) {
        const itemPath = normalizedSourcePath ? `${normalizedSourcePath}/${name}` : name;
        if (normalizedDestPath === itemPath || normalizedDestPath.startsWith(`${itemPath}/`)) {
          invalidMoves.push(name);
          continue;
        }
      }

      if (existsSync(destItemPath)) {
        conflicts.push(name);
        continue;
      }

      movePlan.push({ name, sourceItemPath, destItemPath });
    }

    if (missing.length > 0 || invalidMoves.length > 0) {
      return NextResponse.json(
        {
          error: 'Some items cannot be moved',
          missing,
          invalidMoves,
        },
        { status: 400 },
      );
    }

    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: 'Destination already has items with the same name',
          conflicts,
        },
        { status: 409 },
      );
    }

    for (const plan of movePlan) {
      await rename(plan.sourceItemPath, plan.destItemPath);
      // Broadcast file change to all connected clients
      broadcastFileChange('move', destCheck.fullPath, plan.name, `T-${token}`);
    }

    const duration = Date.now() - startTime;
    logger.info('POST /api/public/[token]/move - Move complete', {
      token,
      count: movePlan.length,
      sourcePath,
      destinationPath,
      duration: `${duration}ms`,
    });

    return NextResponse.json({
      success: true,
      moved: movePlan.map((plan) => plan.name),
      destinationPath,
    });
  } catch (error) {
    logger.error('POST /api/public/[token]/move - Error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
