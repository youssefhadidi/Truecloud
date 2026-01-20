/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir } from 'fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(UPLOAD_DIR);

export async function POST(req) {
  const startTime = Date.now();
  let folderName = 'unknown';
  try {
    logger.info('POST /api/files/mkdir - Create folder request');
    const session = await auth();
    if (!session) {
      logger.warn('POST /api/files/mkdir - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, path: relativePath } = await req.json();
    folderName = name;

    if (!name) {
      logger.warn('POST /api/files/mkdir - Missing folder name');
      return NextResponse.json({ error: 'Folder name required' }, { status: 400 });
    }

    logger.debug('POST /api/files/mkdir - Creating folder', {
      folderName,
      path: relativePath,
      user: session.user.email,
    });

    const targetPath = join(UPLOAD_DIR, relativePath || '', name);

    // Security: prevent directory traversal
    if (!resolve(targetPath).startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/files/mkdir - Directory traversal attempt', {
        folderName,
        targetPath,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    await mkdir(targetPath, { recursive: true });

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/mkdir - Folder created successfully', {
      folderName,
      path: relativePath,
      duration: `${duration}ms`,
    });

    return NextResponse.json({
      success: true,
      folder: {
        name: name,
        path: targetPath,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('POST /api/files/mkdir - Error creating folder', error);
    logger.error('POST /api/files/mkdir - Error details', {
      folderName,
      duration: `${duration}ms`,
    });
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
