/** @format */

import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req, { params }) {
  let writtenFilePath = null;
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');
    const url = new URL(req.url);
    const subPath = url.searchParams.get('path') || '';

    logger.info('POST /api/public/[token]/upload - Request received', {
      token: token.substring(0, 8),
      subPath,
      contentType: req.headers.get('content-type'),
    });

    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return Response.json({ error: 'Password required' }, { status: 401 });
      }
      return Response.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    if (!share.allowUploads) {
      return Response.json({ error: 'Uploads not allowed for this share' }, { status: 403 });
    }

    if (!share.isDirectory) {
      return Response.json({ error: 'Uploads only allowed for directory shares' }, { status: 400 });
    }

    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return Response.json({ error: pathCheck.error }, { status: 400 });
    }

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);

    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return Response.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'Invalid content type' }, { status: 415 });
    }

    const { default: Busboy } = await import('busboy');
    const busboy = Busboy({
      headers: Object.fromEntries(req.headers),
      limits: {
        files: 1,
        fileSize: 100 * 1024 * 1024 * 1024,
      },
    });

    let fileName = 'unknown';
    let fileMimeType = 'application/octet-stream';
    let fileSize = 0;
    let fileReceived = false;
    let writePromise = null;
    let responded = false;
    let responseData = null;

    const respond = (status, payload) => {
      if (responded) return;
      responded = true;
      responseData = { status, payload };
    };

    const cleanup = async () => {
      if (writtenFilePath) {
        try {
          await unlink(writtenFilePath);
        } catch {}
      }
    };

    busboy.on('file', (fieldname, file, info) => {
      if (fieldname !== 'file') {
        file.resume();
        return;
      }

      fileReceived = true;
      const originalName = info?.filename || `upload_${Date.now()}`;
      const safeName = originalName.split(/[/\\]/).pop() || `upload_${Date.now()}`;
      fileName = safeName;
      fileMimeType = info?.mimeType || 'application/octet-stream';
      writtenFilePath = join(targetDir, safeName);

      const writeStream = createWriteStream(writtenFilePath);
      writePromise = new Promise((resolveWrite, rejectWrite) => {
        writeStream.on('finish', resolveWrite);
        writeStream.on('error', rejectWrite);
      });

      file.on('data', (chunk) => {
        fileSize += chunk.length;
      });

      file.on('limit', async () => {
        await cleanup();
        respond(413, { error: 'File too large' });
        file.resume();
      });

      file.on('error', async () => {
        await cleanup();
        respond(500, { error: 'Upload failed' });
      });

      file.pipe(writeStream);
    });

    busboy.on('finish', async () => {
      if (!fileReceived) {
        respond(400, { error: 'No file provided in multipart data' });
      }

      if (fileReceived && !responded) {
        try {
          if (writePromise) {
            await writePromise;
          }
        } catch (error) {
          logger.error('POST /api/public/[token]/upload - Write error', { error: error.message });
          await cleanup();
          respond(500, { error: 'Upload failed' });
        }

        if (!responded) {
          writtenFilePath = null;
          respond(200, {
            success: true,
            file: {
              name: fileName,
              size: fileSize,
              mimeType: fileMimeType,
            },
          });
        }
      }
    });

    busboy.on('error', async (error) => {
      logger.error('POST /api/public/[token]/upload - Busboy error', { error: error.message });
      await cleanup();
      respond(500, { error: 'Upload failed' });
    });

    req.on('aborted', async () => {
      logger.warn('POST /api/public/[token]/upload - Request aborted');
      await cleanup();
    });

    // Pipe the request to busboy
    req.body.pipe(busboy);

    // Wait for busboy to finish
    return new Promise((resolve) => {
      busboy.on('close', () => {
        // Give a short delay for finish handlers to complete
        setTimeout(() => {
          if (responseData) {
            resolve(Response.json(responseData.payload, { status: responseData.status }));
          } else {
            // If no response was set, something went wrong
            resolve(Response.json({ error: 'Upload failed' }, { status: 500 }));
          }
        }, 100);
      });
    });
  } catch (error) {
    logger.error('POST /api/public/[token]/upload - Handler error', {
      error: error.message,
      stack: error.stack,
    });

    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }

    return Response.json({ error: 'Upload failed' }, { status: 500 });
  }
}
