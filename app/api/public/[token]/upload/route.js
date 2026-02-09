/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { createWriteStream } from 'node:fs';
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

    if (!req.body) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Parse multipart FormData via busboy — streams file directly to disk
    const { fileName, size, mimeType } = await new Promise((resolve, reject) => {
      let fileReceived = false;

      const busboy = Busboy({
        headers: { 'content-type': req.headers.get('content-type') },
      });

      busboy.on('file', (_fieldname, fileStream, { filename, mimeType: fileMimeType }) => {
        fileReceived = true;
        const name = filename || 'unknown';
        const mime = fileMimeType || 'application/octet-stream';
        writtenFilePath = join(targetDir, name);

        let sz = 0;

        // Create write stream and pipe file directly to disk
        const writeStream = createWriteStream(writtenFilePath);

        writeStream.on('error', (err) => {
          fileStream.destroy();
          reject(err);
        });

        fileStream.on('data', (chunk) => {
          sz += chunk.length;
        });

        fileStream.on('error', (err) => {
          writeStream.destroy();
          reject(err);
        });

        fileStream.pipe(writeStream);

        writeStream.on('finish', () => {
          resolve({ fileName: name, size: sz, mimeType: mime });
        });
      });

      busboy.on('error', reject);
      busboy.on('finish', () => {
        if (!fileReceived) {
          reject(new Error('No file received in multipart form data'));
        }
      });

      // Manually pump Web ReadableStream to busboy
      const reader = req.body.getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              busboy.end();
              break;
            }
            busboy.write(Buffer.from(value));
          }
        } catch (err) {
          busboy.destroy(err);
          reject(err);
        }
      })();
    });

    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: fileName,
        size,
        mimeType,
      },
    });
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  } finally {
    // Clean up partially written file on error
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
