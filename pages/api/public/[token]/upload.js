/** @format */

import { mkdir, unlink, rename } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';
import { buildTempName } from '@/lib/uploadTemp';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

export default async function handler(req, res) {
  let writtenFilePaths = [];
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
        files: 100,
        fileSize: 100 * 1024 * 1024 * 1024,
      },
    });

    let filesReceived = 0;
    const uploadedFiles = [];
    const writePromises = [];
    let responded = false;

    const respond = (status, payload) => {
      if (responded) return;
      responded = true;
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
      const baseName = originalName.split(/[/\\]/).pop() || '';
      const safeName = (baseName === '.' || baseName === '..' || baseName === '')
        ? `upload_${Date.now()}`
        : baseName;
      const fileMimeType = info?.mimeType || 'application/octet-stream';
      const filePath = join(targetDir, safeName);

      // Stream to a hidden temp name first; rename to the final name on
      // finish so the list/thumbnail endpoints never see a half-written file.
      const tempName = buildTempName(safeName);
      const tempPath = join(targetDir, tempName);
      writtenFilePaths.push(tempPath);

      const fileRecord = {
        name: safeName,
        size: 0,
        mimeType: fileMimeType,
      };

      const writeStream = createWriteStream(tempPath);
      const writePromise = new Promise((resolveWrite, rejectWrite) => {
        writeStream.on('finish', resolveWrite);
        writeStream.on('error', rejectWrite);
      }).then(async () => {
        await rename(tempPath, filePath);
        writtenFilePaths.push(filePath);
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

    busboy.on('error', async () => {
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
      } catch {
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
      const { generateThumbnailForUpload } = await import('@/lib/thumbnailUtils');
      for (const f of uploadedFiles) {
        broadcastFileChange('upload', pathCheck.fullPath, f.name, 'share-' + token);
        generateThumbnailForUpload(join(targetDir, f.name), pathCheck.fullPath, f.name);
      }

      respond(200, payload);
      writtenFilePaths = [];
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
    if (writtenFilePaths.length > 0) {
      await Promise.all(
        writtenFilePaths.map(async (path) => {
          try {
            await unlink(path);
          } catch {}
        }),
      );
    }
  }
}
