/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';
import { requireFolderUnlock } from '@/lib/folderLocks';
import { getXlsxPreviewJson } from '@/lib/xlsxPreview.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function GET(req, { params }) {
  try {
    logger.debug('GET /api/files/parse-xlsx - Request received');
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const url = new URL(req.url);
    const fileId = safeDecodeURIComponent(url.searchParams.get('id') || '');
    let relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/parse-xlsx - Processing', { fileId, path: relativePath });

    // Check user permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/parse-xlsx - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;

    const locked = await requireFolderUnlock(req, relativePath);
    if (locked) return locked;

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/parse-xlsx - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadsDir, relativePath, fileId);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(filePath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('GET /api/files/parse-xlsx - Directory traversal attempt', {
        fileId,
        resolvedTarget,
        user: session.user.email,
      });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if file exists (its size and mtime key the parse cache)
    let stats;
    try {
      stats = await fsPromises.stat(filePath);
    } catch {
      logger.warn('GET /api/files/parse-xlsx - File not found', { filePath });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check file extension
    const fileExt = extname(fileId).toLowerCase();
    if (!['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(fileExt)) {
      logger.error('GET /api/files/parse-xlsx - Invalid file type', { fileExt });
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    // One sheet per request, parsed off the main thread and cached.
    const sheetIndex = Number.parseInt(url.searchParams.get('sheet') || '0', 10) || 0;
    const json = await getXlsxPreviewJson(filePath, stats, sheetIndex);

    return new Response(json, { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    logger.error('GET /api/files/parse-xlsx - Error', { error: error.message });
    return NextResponse.json({ error: 'Failed to parse XLSX file' }, { status: 500 });
  }
}
