/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function GET(req, { params }) {
  try {
    logger.debug('GET /api/files/parse-xlsx - Request received');
    const session = await auth();
    if (!session) {
      logger.warn('GET /api/files/parse-xlsx - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const fileId = decodeURIComponent(url.searchParams.get('id') || '');
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

    // Check if file exists
    try {
      await fsPromises.access(filePath);
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

    // Import xlsx dynamically
    const xlsx = await import('xlsx');

    // Read file
    const fileBuffer = await fsPromises.readFile(filePath);
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

    // Parse all sheets
    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      return {
        name: sheetName,
        data: data,
      };
    });

    logger.debug('GET /api/files/parse-xlsx - Parsed successfully', {
      fileId,
      sheetCount: sheets.length,
    });

    return NextResponse.json({ sheets });
  } catch (error) {
    logger.error('GET /api/files/parse-xlsx - Error', { error: error.message });
    return NextResponse.json({ error: 'Failed to parse XLSX file' }, { status: 500 });
  }
}
