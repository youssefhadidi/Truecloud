/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { readdir } from 'fs/promises';
import { join, basename } from 'node:path';
import archiver from 'archiver';
import sharp from 'sharp';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { Semaphore } from '@/lib/semaphore';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Limit concurrent sharp HEIC decodes globally across requests
const convertSemaphore = new Semaphore(2);

// HEIC decoding + JPEG re-encoding can take a while for large batches
export const maxDuration = 600;

export async function GET(req) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const url = new URL(req.url);
    let relativePath = url.searchParams.get('path') || '';

    if (relativePath.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });
    if (!accessCheck.allowed) {
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }
    relativePath = accessCheck.normalizedPath;

    const folderPath = join(UPLOAD_DIR, relativePath);
    let entries;
    try {
      entries = await readdir(folderPath, { withFileTypes: true });
    } catch (err) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => {
        const lower = n.toLowerCase();
        return lower.endsWith('.heic') || lower.endsWith('.heif');
      });

    if (files.length === 0) {
      return NextResponse.json({ error: 'No HEIC files in folder' }, { status: 404 });
    }

    const archive = archiver('zip', { zlib: { level: 1 } });

    const stream = new ReadableStream({
      cancel() {
        archive.abort();
      },
      start(controller) {
        let isErrored = false;

        archive.on('data', (chunk) => {
          if (isErrored) return;
          try {
            controller.enqueue(chunk);
          } catch (err) {
            isErrored = true;
            controller.error(err);
            archive.abort();
          }
        });
        archive.on('end', () => {
          if (!isErrored) controller.close();
        });
        archive.on('error', (err) => {
          if (!isErrored) {
            isErrored = true;
            controller.error(err);
          }
        });
        archive.on('warning', (err) => {
          if (err.code === 'ENOENT') {
            console.warn('Archive warning:', err.message);
          } else if (!isErrored) {
            isErrored = true;
            controller.error(err);
            archive.abort();
          }
        });

        (async () => {
          for (const fileName of files) {
            if (isErrored) break;
            const srcPath = join(folderPath, fileName);
            await convertSemaphore.acquire();
            try {
              const buffer = await sharp(srcPath, {
                failOn: 'none',
                failOnError: false,
                limitInputPixels: false,
              })
                .rotate()
                .jpeg({ quality: 100 })
                .toBuffer();

              const outName = fileName.replace(/\.(heic|heif)$/i, '.jpeg');
              archive.append(buffer, { name: outName });
            } catch (err) {
              console.error('HEIC convert failed:', fileName, err);
            } finally {
              convertSemaphore.release();
            }
          }
          if (!isErrored) archive.finalize();
        })().catch((err) => {
          console.error('HEIC zip pipeline error:', err);
          if (!isErrored) {
            isErrored = true;
            controller.error(err);
            archive.abort();
          }
        });
      },
    });

    const folderName = basename(relativePath || '') || 'heic-to-jpeg';
    const zipName = `${folderName}-jpeg.zip`;

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('HEIC zip error:', error);
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 });
  }
}
