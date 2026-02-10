/** @format */

import { mkdir, unlink } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export default async function handler(req, res) {
  let writtenFilePath = null;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { token } = req.query;
    const password = req.headers['x-share-password'] || req.query.pwd;
    const subPath = req.query.path || '';

    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return res.status(401).json({ error: 'Password required' });
      }
      return res.status(404).json({ error: verification.error });
    }

    const share = verification.share;

    if (!share.allowUploads) {
      return res.status(403).json({ error: 'Uploads not allowed for this share' });
    }

    if (!share.isDirectory) {
      return res.status(400).json({ error: 'Uploads only allowed for directory shares' });
    }

    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return res.status(400).json({ error: pathCheck.error });
    }

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);

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

    busboy.on('error', async () => {
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
      } catch {
        await cleanup();
        respond(500, { error: 'Upload failed' });
        return;
      }

      writtenFilePath = null;

      respond(200, {
        success: true,
        file: {
          name: fileName,
          size: fileSize,
          mimeType: fileMimeType,
        },
      });
    });

    req.on('aborted', async () => {
      await cleanup();
    });

    req.on('error', async () => {
      await cleanup();
    });

    req.pipe(busboy);
  } catch (error) {
    console.error('POST /api/public/[token]/upload - Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Upload failed' });
    }
  } finally {
    if (writtenFilePath) {
      try {
        await unlink(writtenFilePath);
      } catch {}
    }
  }
}
