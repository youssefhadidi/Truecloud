/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath,
} from '@/lib/shareAuth';
import fs from 'fs';
import { stat, access, mkdir, rename, unlink } from 'fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import mime from 'mime-types';
import { createHash, randomBytes } from 'crypto';
import { logger } from '@/lib/logger';
import {
  checkMoovAtom,
  fixMp4ForStreaming,
  remuxMkvToMp4,
} from '@/lib/ffmpegUtils';
import { nodeToWebStream } from '@/lib/streamUtils';
import { parseRangeHeader } from '@/lib/httpRange';
import { Semaphore } from '@/lib/semaphore.mjs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './stream-cache';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;

// Track in-progress MP4 fixes / MKV remuxes to deduplicate concurrent public
// requests for the same cache path. Without this, N concurrent viewers of the
// same share link each spawn their own ffmpeg process writing to the same file.
const inProgressFixes = new Map();

// Each fix reads and rewrites the whole file, and share links are anonymous —
// without a cap, a visitor opening every video in a shared folder starts one
// ffmpeg per file.
const fixSemaphore = new Semaphore(2);

/**
 * Build `cachedPath` with `produce(tmpPath)`, at most once at a time per path.
 *
 * Written under a temp name and renamed into place: the cache is trusted as
 * soon as it exists and is newer than the source, so a copy still being
 * written — or one left behind by a failed run — was otherwise served
 * truncated, to this visitor and every later one.
 */
function dedupeFix(cachedPath, produce) {
  const existing = inProgressFixes.get(cachedPath);
  if (existing) return existing;
  const p = (async () => {
    await fixSemaphore.acquire();
    // Both producers pass `-f mp4`, so the extension doesn't need to be .mp4.
    const tmpPath = `${cachedPath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
    try {
      await produce(tmpPath);
      await rename(tmpPath, cachedPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    } finally {
      fixSemaphore.release();
    }
  })().finally(() => inProgressFixes.delete(cachedPath));
  inProgressFixes.set(cachedPath, p);
  return p;
}

/**
 * Where a share's streamable copy of `filePath` lives. `.share.mp4`, not
 * `.mp4`: the signed-in stream routes used to treat any `{hash}.mp4` as a
 * finished transcode, and these keep the source's codecs (a faststart copy is
 * still HEVC if the source was), which the browser may not decode.
 */
function shareCachePath(filePath) {
  const cacheDir = resolve(process.cwd(), STREAM_CACHE_DIR);
  const pathHash = createHash('md5').update(filePath).digest('hex');
  return { cacheDir, cachedPath: join(cacheDir, `${pathHash}.share.mp4`) };
}

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    // Accept password from header or query param (for video/audio tags that can't send headers)
    const password = req.headers.get('x-share-password') || url.searchParams.get('pwd');

    // Verify share
    const verification = await verifyShare(token, password, clientIpFromHeaders(req));

    if (!verification.valid) {
      if (verification.rateLimited) {
        return NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
        );
      }
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    // Get optional subpath for directory shares
    const subPath = url.searchParams.get('path') || '';
    const fileName = url.searchParams.get('file') || share.fileName;

    // Build the path to the file. For directory shares, combine the in-share
    // subPath with the target fileName so we resolve to the actual file inside
    // a subfolder rather than the folder itself.
    let pathCheck;
    if (share.isDirectory) {
      const innerPath = subPath
        ? (fileName && fileName !== share.fileName ? `${subPath}/${fileName}` : subPath)
        : (fileName && fileName !== share.fileName ? fileName : '');
      pathCheck = validateSharePath(share, innerPath);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    // Private-uploads shares: visitors can only read their own entries
    // (never the share root itself, e.g. a whole-folder zip)
    const privateCheck = await authorizePrivatePath(share, readShareEmail(req, token), shareInnerPath(share, pathCheck.fullPath));
    if (!privateCheck.allowed) {
      return NextResponse.json(privateAccessErrorBody(privateCheck), { status: privateCheck.status });
    }

    const filePath = join(UPLOAD_DIR, pathCheck.fullPath);
    const resolvedPath = resolve(filePath) + sep;

    // Security: prevent directory traversal
    if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Verify file exists
    try {
      await access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    let streamPath = filePath;
    const fileExt = extname(filePath).toLowerCase();

    // Check if it's an MP4 that might need fixing for streaming
    if (fileExt === '.mp4') {
      const { cacheDir, cachedPath } = shareCachePath(filePath);

      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(filePath), stat(cachedPath)]);

        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
        }
      } catch {
        // Cache doesn't exist
      }

      if (!useCache) {
        const hasMoovAtStart = await checkMoovAtom(filePath);

        if (!hasMoovAtStart) {
          await mkdir(cacheDir, { recursive: true });

          try {
            await dedupeFix(cachedPath, (tmpPath) => fixMp4ForStreaming(filePath, tmpPath));
            streamPath = cachedPath;
          } catch (err) {
            // Fall back to original file
          }
        }
      }
    }

    // MKV files need remuxing to MP4 for browser playback (audio codec compatibility)
    if (fileExt === '.mkv') {
      const { cacheDir, cachedPath } = shareCachePath(filePath);

      let useCache = false;
      try {
        const [sourceStats, cachedStats] = await Promise.all([stat(filePath), stat(cachedPath)]);
        if (cachedStats.mtime >= sourceStats.mtime) {
          useCache = true;
          streamPath = cachedPath;
        }
      } catch {
        // Cache doesn't exist
      }

      if (!useCache) {
        await mkdir(cacheDir, { recursive: true });

        try {
          await dedupeFix(cachedPath, (tmpPath) => remuxMkvToMp4(filePath, tmpPath));
          streamPath = cachedPath;
        } catch (err) {
          // Fall back to original MKV
        }
      }
    }

    const fileStats = await stat(streamPath);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(streamPath) || 'application/octet-stream';

    // Parse range header. Handles suffix ranges (`bytes=-N`), which browsers use
    // to locate the `moov` atom of a non-faststart MP4 — see lib/httpRange.js.
    const parsedRange = parseRangeHeader(req.headers.get('range'), fileSize);

    if (parsedRange?.unsatisfiable) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      });
    }

    if (!parsedRange) {
      return new NextResponse(
        nodeToWebStream(fs.createReadStream(streamPath)),
        {
          headers: {
            'Content-Type': mimeType,
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
          },
        }
      );
    }

    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;

    return new NextResponse(
      nodeToWebStream(fs.createReadStream(streamPath, { start, end })),
      {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': mimeType,
        },
      }
    );
  } catch (error) {
    logger.error('GET /api/public/[token]/stream - Error', { error: error.message });
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
  }
}
