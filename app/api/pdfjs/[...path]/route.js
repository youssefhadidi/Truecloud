/** @format */

import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join, resolve, sep, extname } from 'node:path';

// Serves the runtime assets pdf.js fetches on its own — the worker, the wasm
// image decoders (JBIG2 / JPEG 2000, i.e. most scanned PDFs), CMaps for CJK
// text, standard fonts and ICC profiles — straight from the installed
// pdfjs-dist, so they always match the bundled library version and need no
// copy step in the build. Public (no auth): these are the library's own files,
// and share visitors use the same viewer.

const PDFJS_DIR = resolve(process.cwd(), 'node_modules', 'pdfjs-dist');

// Only these subtrees are reachable; everything else in the package is not.
const ALLOWED_PREFIXES = ['legacy/build/pdf.worker.min.mjs', 'wasm/', 'cmaps/', 'standard_fonts/', 'iccs/'];

const CONTENT_TYPES = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
};

export async function GET(req, { params }) {
  const { path: segments } = await params;
  const relPath = (segments || []).join('/');

  if (relPath.includes('..') || !ALLOWED_PREFIXES.some((p) => relPath === p || (p.endsWith('/') && relPath.startsWith(p)))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const fullPath = join(PDFJS_DIR, relPath);
  if (!fullPath.startsWith(PDFJS_DIR + sep)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let fileStats;
  try {
    fileStats = await stat(fullPath);
    if (!fileStats.isFile()) throw new Error('not a file');
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The files only change when pdfjs-dist is upgraded, which rewrites them.
  const etag = `"${fileStats.size.toString(16)}-${Math.floor(fileStats.mtimeMs / 1000).toString(16)}"`;
  const headers = {
    'Content-Type': CONTENT_TYPES[extname(fullPath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
  };

  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const body = await readFile(fullPath);
  return new NextResponse(body, { headers: { ...headers, 'Content-Length': String(body.length) } });
}
