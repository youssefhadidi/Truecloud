/** @format */

import fs from 'fs';
import { NextResponse } from 'next/server';
import { parseRangeHeader, buildValidators, evaluateConditional } from '@/lib/httpRange';
import { nodeToWebStream } from '@/lib/streamUtils';

/**
 * Serve a file on disk with HTTP range + conditional-request support.
 *
 * WHY THIS EXISTS:
 * The download routes always answered 200 with the whole body and no
 * `Accept-Ranges` / validators, so when a connection dropped mid-download the
 * browser's "Resume" button had nothing to resume against and restarted from
 * byte 0 (or just failed). Browser download managers resume by sending
 * `Range: bytes=<received>-` plus `If-Range: <ETag or Last-Modified>`; this
 * answers that with a 206 for the remaining bytes, or with a fresh 200 when the
 * file changed in between so a stale prefix is never spliced onto new bytes.
 *
 * nodeToWebStream destroys the fs.ReadStream when the client disconnects, so
 * dropped connections don't leak file descriptors.
 *
 * @param {Request} req
 * @param {string} filePath Absolute or cwd-relative path to a regular file.
 * @param {import('fs').Stats} fileStats `stat()` of that file.
 * @param {Record<string, string>} headers Route-specific headers
 *   (Content-Type, Content-Disposition, Cache-Control, ...).
 * @returns {NextResponse}
 */
export function fileRangeResponse(req, filePath, fileStats, headers) {
  const fileSize = fileStats.size;
  const validators = buildValidators(fileStats);
  const baseHeaders = {
    ...headers,
    'Accept-Ranges': 'bytes',
    ETag: validators.etag,
    'Last-Modified': validators.lastModified,
  };

  let range = parseRangeHeader(req.headers.get('range'), fileSize);

  const conditional = evaluateConditional(req, validators, !!range);
  if (conditional.notModified) {
    return new NextResponse(null, { status: 304, headers: baseHeaders });
  }
  // If-Range mismatch: the file changed since the client's first chunk.
  if (conditional.ignoreRange) range = null;

  if (range?.unsatisfiable) {
    return new NextResponse(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` },
    });
  }

  if (!range) {
    return new NextResponse(nodeToWebStream(fs.createReadStream(filePath)), {
      headers: { ...baseHeaders, 'Content-Length': fileSize.toString() },
    });
  }

  const { start, end } = range;
  return new NextResponse(nodeToWebStream(fs.createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': (end - start + 1).toString(),
    },
  });
}
