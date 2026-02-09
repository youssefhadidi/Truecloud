/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import Busboy from 'busboy';

export const maxDuration = 1800;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export async function POST(req, { params }) {
  let writtenFilePath = null;
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');
    const subPath = url.searchParams.get('path') || '';

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Check if uploads are allowed
    if (!share.allowUploads) {
      return NextResponse.json({ error: 'Uploads not allowed for this share' }, { status: 403 });
    }

    // Uploads only work for directory shares
    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Uploads only allowed for directory shares' }, { status: 400 });
    }

    // Validate the upload path is within share scope
    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal
    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Ensure the target directory exists
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Parse multipart upload with busboy — streams file data directly to disk
    const contentType = req.headers.get('content-type') || '';
    const result = await new Promise((resolvePromise, rejectPromise) => {
      let fileInfo = null;
      let fileProcessed = false;

      const bb = Busboy({
        headers: { 'content-type': contentType },
        limits: { files: 1 },
      });

      bb.on('file', (fieldName, stream, { filename, mimeType }) => {
        if (fileProcessed) {
          stream.resume(); // Discard extra files
          return;
        }
        fileProcessed = true;

        const fileName = filename || 'unknown';
        writtenFilePath = join(targetDir, fileName);
        let size = 0;

        const ws = createWriteStream(writtenFilePath);

        ws.on('error', (err) => {
          stream.resume();
          rejectPromise(err);
        });

        stream.on('data', (chunk) => {
          size += chunk.length;
        });

        stream.pipe(ws);

        stream.on('end', () => {
          fileInfo = { name: fileName, size, mimeType: mimeType || 'application/octet-stream' };
        });

        stream.on('error', (err) => {
          ws.destroy();
          rejectPromise(err);
        });
      });

      bb.on('finish', () => {
        if (!fileInfo) {
          rejectPromise(new Error('No file provided'));
        } else {
          resolvePromise(fileInfo);
        }
      });

      bb.on('error', (err) => {
        rejectPromise(err);
      });

      // Pipe the Web ReadableStream into busboy via Readable.fromWeb
      const nodeStream = Readable.fromWeb(req.body);
      nodeStream.on('error', (err) => {
        bb.destroy(err);
      });
      nodeStream.pipe(bb);
    });

    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: result.name,
        size: result.size,
        mimeType: result.mimeType,
      },
    });
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    const message = error.message || 'Upload failed';
    const status = message === 'No file provided' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
