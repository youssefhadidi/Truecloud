/** @format */

import { mkdir, unlink, rename } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, sep } from 'node:path';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, isShareRoot, claimRootName,
} from '@/lib/shareAuth';
import { buildTempName } from '@/lib/uploadTemp';
import { isCachePath, CACHE_PATH_ERROR } from '@/lib/cachePaths.mjs';

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

    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        res.setHeader('Retry-After', String(verification.retryAfter || 60));
        return res.status(429).json({ error: verification.error });
      }
      if (verification.requiresPassword) {
        return res.status(401).json({ error: 'Password required' });
      }
      return res.status(404).json({ error: verification.error });
    }

    const share = verification.share;

    if (!share.allowEditing) {
      return res.status(403).json({ error: 'Uploads not allowed for this share' });
    }

    if (!share.isDirectory) {
      return res.status(400).json({ error: 'Uploads only allowed for directory shares' });
    }

    const pathCheck = validateSharePath(share, subPath);
    if (!pathCheck.allowed) {
      return res.status(400).json({ error: pathCheck.error });
    }

    // Private-uploads shares: visitors can only upload to the root or into
    // their own folders; root uploads get an ownership row per file.
    const email = readShareEmail(req, token);
    const privateCheck = await authorizePrivatePath(share, email, subPath, { allowRoot: true });
    if (!privateCheck.allowed) {
      return res.status(privateCheck.status).json(privateAccessErrorBody(privateCheck));
    }
    const claimAtRoot = share.privateUploads && isShareRoot(subPath);

    const targetDir = join(UPLOAD_DIR, pathCheck.fullPath);

    if (!(resolve(targetDir) + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Never write share uploads into a cache dir configured under UPLOAD_DIR.
    // Checked before the mkdir below, which would otherwise create the tree.
    if (isCachePath(targetDir)) {
      return res.status(403).json({ error: CACHE_PATH_ERROR });
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
      defParamCharset: 'utf8',
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
        // Claim the final name only once the bytes are on disk, so the claim
        // and the rename happen back to back.
        if (claimAtRoot) {
          fileRecord.name = await claimRootName(share, email, targetDir, safeName);
        }
        const filePath = join(targetDir, fileRecord.name);
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

      // Files are on disk: respond before side effects so a failure in the
      // broadcast/thumbnail step can't leave the client waiting forever.
      writtenFilePaths = [];
      respond(200, payload);

      try {
        const { broadcastFileChange } = await import('@/lib/fileChangeBroadcast');
        const { generateThumbnailForUpload } = await import('@/lib/thumbnailUtils');
        for (const f of uploadedFiles) {
          broadcastFileChange('upload', pathCheck.fullPath, f.name, 'share-' + token);
          generateThumbnailForUpload(join(targetDir, f.name), pathCheck.fullPath, f.name);
        }
      } catch (error) {
        console.error('POST /api/public/[token]/upload - Post-upload hooks failed:', error);
      }
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
  }
}
