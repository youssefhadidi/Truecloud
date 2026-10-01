/** @format */

import { NextResponse } from 'next/server';
import { join, resolve, relative, sep } from 'node:path';
import {
  verifyShare, validateSharePath, clientIpFromHeaders,
  readShareEmail, authorizePrivatePath, privateAccessErrorBody, shareInnerPath, isWithinShare,
} from './shareAuth.mjs';
import { isCachePath, CACHE_PATH_ERROR } from './cachePaths.mjs';

const UPLOAD_ROOT = resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');

/**
 * The share password of a request: the header when the client can set one,
 * else `pwd` — <video src>, hls.js segment fetches and <track src> can't.
 */
export function sharePasswordFrom(req, url = new URL(req.url)) {
  return req.headers.get('x-share-password') || url.searchParams.get('pwd');
}

/**
 * Authorise read access to one item of a share and resolve it on disk.
 *
 * `innerPath` is relative to the share root ('' is the shared item itself,
 * which is the only valid value for a single-file share).
 *
 * The returned `fullPath` is absolute and built exactly like the signed-in
 * routes build theirs (UPLOAD_DIR resolved, then joined), so caches keyed on
 * the path — HLS renditions, probes, subtitles — are shared between a share
 * visitor and the owner watching the same file.
 *
 * @returns {Promise<{ error: NextResponse } | { share: object, fullPath: string, innerPath: string }>}
 */
export async function resolveShareFile(req, token, innerPath, { password } = {}) {
  const verification = await verifyShare(token, password ?? sharePasswordFrom(req), clientIpFromHeaders(req));

  if (!verification.valid) {
    if (verification.rateLimited) {
      return {
        error: NextResponse.json(
          { error: verification.error },
          { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } },
        ),
      };
    }
    if (verification.requiresPassword) {
      return { error: NextResponse.json({ error: 'Password required' }, { status: 401 }) };
    }
    return { error: NextResponse.json({ error: verification.error }, { status: 404 }) };
  }

  const share = verification.share;
  // A single-file share has nothing inside it: whatever the client names, it
  // gets the shared file (as the image, xlsx and thumbnail routes do).
  const pathCheck = validateSharePath(share, share.isDirectory ? innerPath : '');
  if (!pathCheck.allowed) {
    return { error: NextResponse.json({ error: pathCheck.error }, { status: 400 }) };
  }

  // Private-uploads shares: visitors can only read their own entries
  const inner = shareInnerPath(share, pathCheck.fullPath);
  const privateCheck = await authorizePrivatePath(share, readShareEmail(req, token), inner);
  if (!privateCheck.allowed) {
    return { error: NextResponse.json(privateAccessErrorBody(privateCheck), { status: privateCheck.status }) };
  }

  // Security: prevent directory traversal (including via symlinks)
  if (!(await isWithinShare(share, pathCheck.fullPath))) {
    return { error: NextResponse.json({ error: 'Invalid path' }, { status: 400 }) };
  }

  const fullPath = join(UPLOAD_ROOT, pathCheck.fullPath);

  // Cache dirs under UPLOAD_DIR are hidden from share listings; don't serve them either
  if (isCachePath(fullPath)) {
    return { error: NextResponse.json({ error: CACHE_PATH_ERROR }, { status: 403 }) };
  }

  return { share, fullPath, innerPath: inner };
}

/**
 * Whether an absolute path (e.g. a sibling of an authorised file) may be read
 * through this share. Siblings of a single-file share never can: the share
 * exposes the file alone.
 */
export async function isShareSiblingReadable(req, token, share, absPath) {
  if (!share.isDirectory) return false;
  const rel = relative(UPLOAD_ROOT, absPath).split(sep).join('/');
  if (!rel || rel.startsWith('..')) return false;
  if (!(await isWithinShare(share, rel))) return false;
  if (isCachePath(absPath)) return false;
  const check = await authorizePrivatePath(share, readShareEmail(req, token), shareInnerPath(share, rel));
  return check.allowed;
}

/**
 * Query suffix that carries the share password forward into URLs the browser
 * will fetch on its own (HLS manifest → segments, subtitle tracks).
 */
export function sharePasswordSuffix(password) {
  return password ? `&pwd=${encodeURIComponent(password)}` : '';
}
