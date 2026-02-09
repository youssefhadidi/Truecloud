/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import formidable from 'formidable';

/**
 * Convert a Web ReadableStream to a Node.js Readable stream reliably.
 * Readable.fromWeb() has backpressure bugs in Node 21 that can truncate data.
 */
function webStreamToNodeStream(webStream, headers) {
  const passthrough = new PassThrough({ highWaterMark: 1024 * 1024 }); // 1 MB buffer
  passthrough.headers = headers;
  const reader = webStream.getReader();
  let destroyed = false;

  const cancel = () => {
    destroyed = true;
    reader.cancel().catch(() => {});
  };
  passthrough.on('error', cancel);

  (async () => {
    try {
      while (!destroyed) {
        const { done, value } = await reader.read();
        if (done) {
          passthrough.end();
          break;
        }
        if (destroyed) break;
        if (!passthrough.write(value)) {
          // Wait for drain but bail out if the stream dies
          await new Promise((res, rej) => {
            const onDrain = () => {
              passthrough.removeListener('close', onFail);
              passthrough.removeListener('error', onFail);
              res();
            };
            const onFail = (err) => {
              passthrough.removeListener('drain', onDrain);
              rej(err || new Error('Stream closed'));
            };
            passthrough.once('drain', onDrain);
            passthrough.once('close', onFail);
            passthrough.once('error', onFail);
          });
        }
      }
    } catch (err) {
      if (!destroyed) passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
    } finally {
      cancel();
    }
  })();
  return passthrough;
}

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

    let fileName = '';

    // Configure formidable to write directly to the target directory (no temp files)
    const form = formidable({
      maxFileSize: 200 * 1024 * 1024 * 1024, // 200 GB
      maxTotalFileSize: 200 * 1024 * 1024 * 1024,
      allowEmptyFiles: false,
      multiples: false,
      fileWriteStreamHandler: (file) => {
        fileName = file.originalFilename || 'unknown';
        writtenFilePath = join(targetDir, fileName);
        return createWriteStream(writtenFilePath);
      },
    });

    // Stream request body directly to formidable → disk
    const headers = Object.fromEntries(req.headers.entries());
    const nodeStream = webStreamToNodeStream(req.body, headers);

    let files;
    try {
      [, files] = await form.parse(nodeStream);
    } catch (parseError) {
      return NextResponse.json({ error: 'Upload parsing failed', details: parseError.message }, { status: 400 });
    }

    const uploadedFile = files.file?.[0];
    if (!uploadedFile) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    writtenFilePath = null; // Success — don't clean up

    return NextResponse.json({
      success: true,
      file: {
        name: fileName,
        size: uploadedFile.size,
        mimeType: uploadedFile.mimetype,
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
