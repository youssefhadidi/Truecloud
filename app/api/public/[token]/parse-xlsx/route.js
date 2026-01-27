/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { join, resolve, extname, sep } from 'node:path';
import fsPromises from 'fs/promises';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

    // Build the path
    let pathCheck;
    if (share.isDirectory && subPath) {
      pathCheck = validateSharePath(share, subPath);
    } else if (share.isDirectory && fileName !== share.fileName) {
      pathCheck = validateSharePath(share, fileName);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadsDir, pathCheck.fullPath);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(filePath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check file extension
    const fileExt = extname(fileName).toLowerCase();
    if (!['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(fileExt)) {
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

    return NextResponse.json({ sheets });
  } catch (error) {
    console.error('GET /api/public/[token]/parse-xlsx - Error:', error);
    return NextResponse.json({ error: 'Failed to parse XLSX file' }, { status: 500 });
  }
}
