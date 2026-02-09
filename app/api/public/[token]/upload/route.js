/** @format */

import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import formidable from 'formidable';

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

    // DEBUG: Log incoming request details
    const contentType = req.headers.get('content-type');
    const contentLength = req.headers.get('content-length');
    console.log('DEBUG: Request details', {
      contentType,
      contentLength,
      hasBody: !!req.body,
      bodyType: req.body?.constructor?.name,
    });

    // Read entire body as Buffer to verify we get all data
    console.log('DEBUG: Starting to read request body as Buffer');
    const bufferReadStart = Date.now();
    const chunks = [];
    const reader = req.body.getReader();
    let totalBytesRead = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        totalBytesRead += value.length;
        if (totalBytesRead % (1024 * 1024) === 0) {
          console.log('DEBUG: Read progress', { bytesRead: totalBytesRead });
        }
      }
    } catch (err) {
      console.log('DEBUG: Error reading body', { message: err.message });
      throw err;
    }

    const bufferReadDuration = Date.now() - bufferReadStart;
    const bodyBuffer = Buffer.concat(chunks);
    console.log('DEBUG: Body read complete', {
      duration: `${bufferReadDuration}ms`,
      totalBytes: bodyBuffer.length,
      declaredBytes: contentLength,
      bytesMatch: bodyBuffer.length === parseInt(contentLength),
    });

    // Create Node.js Readable from Buffer
    console.log('DEBUG: Creating Readable from Buffer');
    const nodeReadable = Readable.from([bodyBuffer]);

    // Create a pseudo-request object with headers for formidable
    const headersObj = Object.fromEntries(req.headers);
    console.log('DEBUG: Headers object created', {
      contentType: headersObj['content-type'],
      contentLength: headersObj['content-length'],
    });

    const pseudoReq = Object.assign(nodeReadable, {
      headers: headersObj,
    });

    console.log('DEBUG: Pseudo request created from Buffer', {
      hasHeaders: !!pseudoReq.headers,
      hasOn: typeof pseudoReq.on === 'function',
      bufferSize: bodyBuffer.length,
    });

    const form = formidable({
      uploadDir: targetDir,
      keepExtensions: true,
      multiples: false,
    });

    // Add formidable event listeners for debugging
    form.on('file', (fieldname, file) => {
      console.log('DEBUG: Formidable file event', {
        fieldname,
        filename: file.filename,
        size: file.size,
      });
    });

    form.on('error', (err) => {
      console.log('DEBUG: Formidable error event', {
        message: err.message,
        code: err.code,
      });
    });

    // Wrap callback-based API in Promise (more reliable than form.parse())
    console.log('DEBUG: Starting form.parse()');
    let parseStartTime = Date.now();

    const { parsedFileName, fileSize, fileMimeType } = await new Promise((resolve, reject) => {
      form.parse(pseudoReq, (err, _, files) => {
        const parseDuration = Date.now() - parseStartTime;
        console.log('DEBUG: form.parse() callback fired', {
          duration: `${parseDuration}ms`,
          hasError: !!err,
          errorMessage: err?.message,
          fileCount: files?.file?.length || 0,
        });

        if (err) {
          console.log('DEBUG: form.parse() error', {
            message: err.message,
            code: err.code,
          });
          reject(err);
          return;
        }

        const uploadedFiles = files.file;
        if (!uploadedFiles || uploadedFiles.length === 0) {
          console.log('DEBUG: No file in parsed data');
          reject(new Error('No file provided in multipart data'));
          return;
        }

        const uploadedFile = uploadedFiles[0];
        writtenFilePath = uploadedFile.filepath;

        console.log('DEBUG: File parsed successfully', {
          filepath: uploadedFile.filepath,
          size: uploadedFile.size,
        });

        resolve({
          parsedFileName: uploadedFile.originalFilename || 'unknown',
          fileSize: uploadedFile.size,
          fileMimeType: uploadedFile.mimetype || 'application/octet-stream',
        });
      });
    });

    const fileName = parsedFileName;
    const size = fileSize;
    const mimeType = fileMimeType;
    console.log('DEBUG: Parse complete');

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
