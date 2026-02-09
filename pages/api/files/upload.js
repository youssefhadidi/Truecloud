/** @format */

import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';

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
    let logger = null;
    try {
      ({ logger } = await import('@/lib/logger'));
    } catch {
      logger = null;
    }

    const logInfo = (message, data) => {
      if (logger?.info) {
        logger.info(message, data);
      } else {
        console.log(message, data);
      }
    };

    const logError = (message, data) => {
      if (logger?.error) {
        logger.error(message, data);
      } else {
        console.error(message, data);
      }
    };

    logInfo('POST /api/files/upload - Request received (pages api)', {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { getServerSession } = await import('next-auth/next');
    const { authOptions } = await import('@/lib/authOptions');
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    logInfo('POST /api/files/upload - Session ok (pages api)', {
      userId: session.user?.id,
      email: session.user?.email,
    });

    const queryPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path || '';
    let relativePath = queryPath;

    const { hasRootAccess, checkPathAccess } = await import('@/lib/pathPermissions');
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
    logInfo('POST /api/files/upload - Access ok (pages api)', {
      path: accessCheck.normalizedPath,
      isRoot,
    });

    relativePath = accessCheck.normalizedPath;
    const targetDir = join(UPLOAD_DIR, relativePath);

    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }
    logInfo('POST /api/files/upload - Target dir ready (pages api)', {
      targetDir,
    });

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(415).json({ error: 'Invalid content type' });
    }

    logInfo('POST /api/files/upload - Incoming request (pages api)', {
      contentType,
      contentLength: req.headers['content-length'],
      path: relativePath,
    });

    const { default: Busboy } = await import('busboy');
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 100 * 1024 * 1024 * 1024,
      },
    });
    logInfo('POST /api/files/upload - Busboy initialized (pages api)');

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
      if (status >= 500) {
        logError('POST /api/files/upload - Responding with error (pages api)', {
          status,
          payload,
        });
      }
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

    busboy.on('finish', () => {
      logInfo('POST /api/files/upload - Busboy finished (pages api)', {
        fileReceived,
        fileName,
        fileSize,
      });
    });

    busboy.on('error', async (error) => {
      logError('POST /api/files/upload - Busboy error (pages api)', {
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
        logError('POST /api/files/upload - Write failed (pages api)', {
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
      logError('POST /api/files/upload - Request aborted (pages api)');
      await cleanup();
    });

    req.on('error', (error) => {
      logError('POST /api/files/upload - Request error (pages api)', {
        message: error?.message,
        stack: error?.stack,
      });
    });

    req.pipe(busboy);
  } catch (error) {
    console.error('POST /api/files/upload - Handler error (pages api)', {
      message: error?.message,
      stack: error?.stack,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
}
