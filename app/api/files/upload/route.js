/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'node:path';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(UPLOAD_DIR);

export async function POST(req) {
  const startTime = Date.now();
  let fileName = 'unknown';
  try {
    logger.info('POST /api/files/upload - Upload request received');
    const session = await auth();
    if (!session) {
      logger.warn('POST /api/files/upload - Unauthorized upload attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      logger.info('POST /api/files/upload - Creating upload directory', { dir: UPLOAD_DIR });
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const relativePath = formData.get('path') || '';

    if (!file) {
      logger.warn('POST /api/files/upload - No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    fileName = file.name;
    logger.debug('POST /api/files/upload - Processing file', {
      fileName,
      fileSize: file.size,
      fileType: file.type,
      path: relativePath,
      user: session.user.email,
    });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Ensure target directory exists
    const targetDir = join(UPLOAD_DIR, relativePath);
    if (!existsSync(targetDir)) {
      logger.debug('POST /api/files/upload - Creating target directory', { dir: targetDir });
      await mkdir(targetDir, { recursive: true });
    }

    // Security: prevent directory traversal
    if (!resolve(targetDir).startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('POST /api/files/upload - Directory traversal attempt', {
        targetDir,
        uploadDir: UPLOAD_DIR,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Save file directly to storage with original name
    const filePath = join(targetDir, file.name);
    await writeFile(filePath, buffer);

    const duration = Date.now() - startTime;
    logger.info('POST /api/files/upload - File uploaded successfully', {
      fileName,
      fileSize: file.size,
      path: relativePath,
      duration: `${duration}ms`,
    });

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        path: filePath,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('POST /api/files/upload - Upload failed', error);
    logger.error('POST /api/files/upload - Error details', {
      fileName,
      duration: `${duration}ms`,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
