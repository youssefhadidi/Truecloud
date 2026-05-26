/** @format */

import { mkdir, unlink, stat } from 'fs/promises';
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

    // Folder lock gate. Pages API uses Node req.headers (lowercased), so we
    // can't reuse requireFolderUnlock (NextResponse-based) and instead drive
    // the lower-level helpers directly.
    const { getAllLockedPaths, findAncestorLockPath, verifyFolderPin } = await import('@/lib/folderLocks');
    const lockedPaths = await getAllLockedPaths();
    const ancestor = lockedPaths.length ? findAncestorLockPath(relativePath, lockedPaths) : null;
    if (ancestor) {
      let pin = req.headers['x-folder-pin'];
      if (!pin) {
        const raw = req.headers['x-folder-pins'];
        if (raw) {
          try {
            const map = JSON.parse(raw);
            if (map && typeof map[ancestor] === 'string') pin = map[ancestor];
          } catch {}
        }
      }
      if (!pin && req.query?.folderPin) pin = String(req.query.folderPin);
      if (!pin) {
        return res.status(423).json({ error: 'pin_required', path: ancestor });
      }
      const result = await verifyFolderPin(ancestor, pin);
      if (!result.ok) {
        if (result.lockedOut) {
          res.setHeader('Retry-After', String(result.retryAfter));
          return res.status(429).json({ error: 'pin_locked_out', path: ancestor, retryAfter: result.retryAfter });
        }
        return res.status(401).json({ error: 'pin_incorrect', path: ancestor });
      }
    }

    const targetDir = join(UPLOAD_DIR, relativePath);

    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }


    // Strip directory separators, NUL bytes, and reject filenames that would
    // resolve to the parent directory ("..") or the directory itself ("."). The
    // resolve-and-prefix check below is defense-in-depth on top of this.
    const sanitizeFilename = (raw) => {
      const stripped = (String(raw ?? '').split(/[/\\]/).pop() ?? '').replace(/\0/g, '');
      if (!stripped || stripped === '.' || stripped === '..') return null;
      return stripped;
    };

    const isWithinTargetDir = (filePath) => {
      const resolvedFile = resolve(filePath);
      const resolvedDir = resolve(targetDir);
      return resolvedFile === resolvedDir
        ? false
        : (resolvedFile + sep).startsWith(resolvedDir + sep);
    };

    const contentType = req.headers['content-type'] || '';
    const isMultipart = contentType.includes('multipart/form-data');

    if (isMultipart) {
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
      if (fieldname !== 'file' || responded) {
        file.resume();
        return;
      }

      const originalName = info?.filename || `upload_${Date.now()}`;
      const safeName = sanitizeFilename(originalName);
      if (!safeName) {
        file.resume();
        cleanup().finally(() => respond(400, { error: 'Invalid filename' }));
        return;
      }

      const fileMimeType = info?.mimeType || 'application/octet-stream';
      const filePath = join(targetDir, safeName);
      if (!isWithinTargetDir(filePath)) {
        file.resume();
        cleanup().finally(() => respond(400, { error: 'Invalid path' }));
        return;
      }

      filesReceived += 1;
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
    } else {
      // Raw binary body path. The mobile client streams large videos here
      // because the multipart path requires a full in-memory copy on the
      // client side and crashes on files >500 MB.
      const filenameQuery = Array.isArray(req.query.filename)
        ? req.query.filename[0]
        : req.query.filename;
      const safeName = sanitizeFilename(filenameQuery);
      if (!safeName) {
        return res.status(400).json({
          error: 'Missing or invalid filename query parameter',
        });
      }

      const filePath = join(targetDir, safeName);
      if (!isWithinTargetDir(filePath)) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      const fileMimeType = contentType || 'application/octet-stream';
      const normalizedFilePath = filePath
        .replace(/\\/g, '/')
        .replace(new RegExp(`^${UPLOAD_DIR.replace(/\\/g, '/')}/`), '');

      let responded = false;
      const respond = (status, payload) => {
        if (responded) return;
        responded = true;
        if (status >= 500) {
          logError('POST /api/files/upload - Responding with error (raw body)', {
            status,
            payload,
          });
        }
        res.status(status).json(payload);
      };

      const cleanup = async () => {
        try {
          await unlink(filePath);
        } catch {}
      };

      // Default flag 'w' overwrites existing files, matching the multipart
      // branch's collision behavior.
      const writeStream = createWriteStream(filePath);

      writeStream.on('error', async (error) => {
        logError('POST /api/files/upload - Write error (raw body)', {
          message: error?.message,
          stack: error?.stack,
        });
        try { req.unpipe(writeStream); } catch {}
        await cleanup();
        respond(500, { error: 'Upload failed' });
      });

      req.on('aborted', async () => {
        logError('POST /api/files/upload - Request aborted (raw body)');
        try { writeStream.destroy(); } catch {}
        await cleanup();
      });

      req.on('error', async (error) => {
        logError('POST /api/files/upload - Request error (raw body)', {
          message: error?.message,
          stack: error?.stack,
        });
        try { writeStream.destroy(); } catch {}
        await cleanup();
        respond(500, { error: 'Upload failed' });
      });

      writeStream.on('finish', async () => {
        if (responded) return;
        try {
          const stats = await stat(filePath);
          const fileRecord = {
            name: safeName,
            size: stats.size,
            mimeType: fileMimeType,
            path: normalizedFilePath,
          };
          const { broadcastFileChange } = await import('@/lib/fileChangeBroadcast');
          broadcastFileChange('upload', relativePath, fileRecord.name, token.id);
          respond(200, {
            success: true,
            files: [fileRecord],
            file: fileRecord,
          });
        } catch (error) {
          logError('POST /api/files/upload - Stat failed (raw body)', {
            message: error?.message,
            stack: error?.stack,
          });
          await cleanup();
          respond(500, { error: 'Upload failed' });
        }
      });

      req.pipe(writeStream);
    }
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
