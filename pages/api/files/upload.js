/** @format */

import Busboy from 'busboy';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { logger } from '@/lib/logger';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export default async function handler(req, res) {
  try {
    logger.info('POST /api/files/upload - Request received (pages api)', {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const queryPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path || '';
    let relativePath = queryPath;

    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'write',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      return res.status(accessCheck.status).json({ error: accessCheck.error });
    }

    relativePath = accessCheck.normalizedPath;
    const targetDir = join(UPLOAD_DIR, relativePath);

    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(415).json({ error: 'Invalid content type' });
    }

    logger.info('POST /api/files/upload - Incoming request (pages api)', {
      contentType,
      contentLength: req.headers['content-length'],
      path: relativePath,
    });

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 100 * 1024 * 1024 * 1024,
      },
    });

    let fileName = 'unknown';
    let fileMimeType = 'application/octet-stream';
    let fileSize = 0;
    let fileReceived = false;
    let writtenFilePath = null;
    let writePromise = null;
    let responded = false;

    const respond = (status, payload) => {
      if (responded) return;
      responded = true;
      res.status(status).json(payload);
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

    busboy.on('error', async (error) => {
      logger.error('POST /api/files/upload - Busboy error (pages api)', {
        message: error?.message,
        stack: error?.stack,
      });
      await cleanup();
      respond(500, { error: 'Upload failed' });
    });

    busboy.on('finish', async () => {
      if (!fileReceived) {
        respond(400, { error: 'No file provided in multipart data' });
        return;
      }

      try {
        if (writePromise) {
          await writePromise;
        }
      } catch (error) {
        logger.error('POST /api/files/upload - Write failed (pages api)', {
          message: error?.message,
          stack: error?.stack,
        });
        await cleanup();
        respond(500, { error: 'Upload failed' });
        return;
      }

      const normalizedFilePath = writtenFilePath
        .replace(/\\/g, '/')
        .replace(new RegExp(`^${UPLOAD_DIR.replace(/\\/g, '/')}/`), '');

      writtenFilePath = null;

      respond(200, {
        success: true,
        file: {
          name: fileName,
          size: fileSize,
          mimeType: fileMimeType,
          path: normalizedFilePath,
        },
      });
    });

    req.on('aborted', async () => {
      await cleanup();
    });

    req.pipe(busboy);
  } catch (error) {
    logger.error('POST /api/files/upload - Handler error (pages api)', {
      message: error?.message,
      stack: error?.stack,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
}
