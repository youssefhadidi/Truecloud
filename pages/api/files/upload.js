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



    const logError = (message, data) => {
      try {
        if (logger?.error) {
          logger.error(message, data);
        } else {
          console.error(message, data);
        }
      } catch (error) {
        console.error('[Logger fallback]', message, data, error?.message);
      }
    };


    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { getToken } = await import('next-auth/jwt');
    let token = null;
    try {
      token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    } catch (error) {
      logError('POST /api/files/upload - Token check failed (pages api)', {
        message: error?.message,
        stack: error?.stack,
      });
      return res.status(500).json({ error: 'Session check failed' });
    }
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    const queryPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path || '';
    let relativePath = queryPath;

    const { hasRootAccess, checkPathAccess } = await import('@/lib/pathPermissions');
    const isRoot = await hasRootAccess(token.id);
    const accessCheck = checkPathAccess({
      userId: token.id,
      path: relativePath,
      operation: 'write',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      return res.status(accessCheck.status).json({ error: accessCheck.error });
    }


    relativePath = accessCheck.normalizedPath;

    // Folder lock gate. Pages API uses Node req.headers (lowercased).
    const { getRootSegment, isLockableRootFolder, verifyFolderPin } = await import('@/lib/folderLocks');
    const { prisma: prismaForLock } = await import('@/lib/prisma');
    const rootSeg = getRootSegment(relativePath);
    if (isLockableRootFolder(rootSeg)) {
      const existingLock = await prismaForLock.folderLock.findUnique({
        where: { path: rootSeg },
        select: { id: true },
      });
      if (existingLock) {
        const pin = req.headers['x-folder-pin'];
        if (!pin) {
          return res.status(423).json({ error: 'pin_required', path: rootSeg });
        }
        const result = await verifyFolderPin(rootSeg, pin);
        if (!result.ok) {
          if (result.lockedOut) {
            res.setHeader('Retry-After', String(result.retryAfter));
            return res.status(429).json({ error: 'pin_locked_out', path: rootSeg, retryAfter: result.retryAfter });
          }
          return res.status(401).json({ error: 'pin_incorrect', path: rootSeg });
        }
      }
    }

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


    const { default: Busboy } = await import('busboy');
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 100,
        fileSize: 100 * 1024 * 1024 * 1024,
      },
    });

    let filesReceived = 0;
    const uploadedFiles = [];
    const writePromises = [];
    const writtenFilePaths = [];
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
      if (writtenFilePaths.length === 0) return;
      await Promise.all(
        writtenFilePaths.map(async (path) => {
          try {
            await unlink(path);
          } catch {}
        }),
      );
    };

    busboy.on('file', (fieldname, file, info) => {
      if (fieldname !== 'file') {
        file.resume();
        return;
      }

      filesReceived += 1;
      const originalName = info?.filename || `upload_${Date.now()}`;
      const safeName = originalName.split(/[/\\]/).pop() || `upload_${Date.now()}`;
      const fileMimeType = info?.mimeType || 'application/octet-stream';
      const filePath = join(targetDir, safeName);
      const normalizedFilePath = filePath
        .replace(/\\/g, '/')
        .replace(new RegExp(`^${UPLOAD_DIR.replace(/\\/g, '/')}/`), '');

      writtenFilePaths.push(filePath);

      const fileRecord = {
        name: safeName,
        size: 0,
        mimeType: fileMimeType,
        path: normalizedFilePath,
      };

      const writeStream = createWriteStream(filePath);
      const writePromise = new Promise((resolveWrite, rejectWrite) => {
        writeStream.on('finish', resolveWrite);
        writeStream.on('error', rejectWrite);
      }).then(() => {
        uploadedFiles.push(fileRecord);
      });

      writePromises.push(writePromise);

      file.on('data', (chunk) => {
        fileRecord.size += chunk.length;
      });

      file.on('limit', async () => {
        if (responded) return;
        await cleanup();
        respond(413, { error: 'File too large' });
        file.resume();
      });

      file.on('error', async () => {
        if (responded) return;
        await cleanup();
        respond(500, { error: 'Upload failed' });
      });

      file.pipe(writeStream);
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
      if (responded) return;
      if (filesReceived === 0) {
        respond(400, { error: 'No file provided in multipart data' });
        return;
      }

      try {
        await Promise.all(writePromises);
      } catch (error) {
        logError('POST /api/files/upload - Write failed (pages api)', {
          message: error?.message,
          stack: error?.stack,
        });
        await cleanup();
        respond(500, { error: 'Upload failed' });
        return;
      }

      const payload = {
        success: true,
        files: uploadedFiles,
      };
      if (uploadedFiles.length === 1) {
        payload.file = uploadedFiles[0];
      }

      const { broadcastFileChange } = await import('@/lib/fileChangeBroadcast');
      for (const f of uploadedFiles) {
        broadcastFileChange('upload', relativePath, f.name, token.id);
      }

      respond(200, payload);
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
