/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath, isWithinShare,
} from '@/lib/shareAuth';
import { join, resolve, extname } from 'node:path';
import fsPromises from 'fs/promises';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';
import { getXlsxPreviewJson } from '@/lib/xlsxPreview.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    // Verify share
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

    // Build the path. For directory shares, combine the in-share subPath with
    // the target fileName so we resolve to the actual file rather than its
    // parent directory.
    let pathCheck;
    if (share.isDirectory) {
      const innerPath = subPath
        ? (fileName && fileName !== share.fileName ? `${subPath}/${fileName}` : subPath)
        : (fileName && fileName !== share.fileName ? fileName : '');
      pathCheck = validateSharePath(share, innerPath);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Private-uploads shares: visitors can only read their own entries
    // (never the share root itself, e.g. a whole-folder zip)
    const privateCheck = await authorizePrivatePath(share, readShareEmail(req, token), shareInnerPath(share, pathCheck.fullPath));
    if (!privateCheck.allowed) {
      return NextResponse.json(privateAccessErrorBody(privateCheck), { status: privateCheck.status });
    }

    const uploadsDir = resolve(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadsDir, pathCheck.fullPath);

    // Security: prevent directory traversal (including via symlinks)
    if (!(await isWithinShare(share, pathCheck.fullPath))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Cache dirs under UPLOAD_DIR are hidden from share listings; don't serve them either
    if (isCachePath(filePath)) {
      return NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 });
    }

    // Check if file exists (its size and mtime key the parse cache)
    let stats;
    try {
      stats = await fsPromises.stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check file extension
    const fileExt = extname(fileName).toLowerCase();
    if (!['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(fileExt)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    // One sheet per request, parsed off the main thread and cached.
    const sheetIndex = Number.parseInt(url.searchParams.get('sheet') || '0', 10) || 0;
    const json = await getXlsxPreviewJson(filePath, stats, sheetIndex);

    return new Response(json, { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('GET /api/public/[token]/parse-xlsx - Error:', error);
    return NextResponse.json({ error: 'Failed to parse XLSX file' }, { status: 500 });
  }
}
