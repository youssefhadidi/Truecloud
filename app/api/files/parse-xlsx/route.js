/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { join, resolve, extname } from 'node:path';
import fsPromises from 'fs/promises';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

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
    const relativePath = url.searchParams.get('path') || '';

    logger.debug('GET /api/files/parse-xlsx - Processing', { fileId, path: relativePath });

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      logger.error('GET /api/files/parse-xlsx - Directory traversal attempt', { fileId, relativePath });
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadsDir, relativePath, fileId);

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
