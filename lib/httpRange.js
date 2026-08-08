/** @format */

/**
 * RFC 7233 single byte-range parsing.
 *
 * WHY THIS EXISTS:
 * The previous inline parsers did `range.replace(/bytes=/, '').split('-')` and
 * read `parseInt(parts[0]) || 0` as the start. That silently mis-parses a
 * *suffix* range — `Range: bytes=-65536`, meaning "the last 65536 bytes" —
 * as `start = 0`, so the server answered with the FIRST 65536 bytes and
 * labelled them `Content-Range: bytes 0-65535/<size>`.
 *
 * Browsers send suffix ranges when an MP4 is not `faststart` (the `moov` atom
 * sits at the end of the file). The player reads the head, finds no `moov`,
 * asks for the tail, gets the head back again, and retries forever — the
 * "same first chunk over and over" symptom, with playback never starting.
 *
 * @param {string|null|undefined} rangeHeader Raw `Range` header value.
 * @param {number} fileSize Total size of the entity in bytes.
 * @returns {{start: number, end: number} | {unsatisfiable: true} | null}
 *   - `{start, end}` — inclusive byte offsets, already clamped to the entity.
 *   - `{unsatisfiable: true}` — well-formed but outside the entity → respond 416.
 *   - `null` — absent, malformed, or multi-range → ignore it and serve 200 with
 *     the full body, as RFC 7233 §3.1 requires for unsatisfiable-to-parse values.
 */
export function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) return null;

  // Deliberately only single ranges: multi-range (`bytes=0-9,20-29`) needs a
  // multipart/byteranges body, which no caller here produces. Failing the match
  // makes us serve the whole entity, which is always correct.
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null; // "bytes=-" is malformed

  let start;
  let end;

  if (rawStart === '') {
    // Suffix range: the last N bytes of the entity.
    const suffixLength = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? fileSize - 1 : Math.min(parseInt(rawEnd, 10), fileSize - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  }

  if (fileSize === 0 || start >= fileSize || start > end) return { unsatisfiable: true };

  return { start, end };
}

/**
 * RFC 7232 conditional-request support.
 *
 * WHY THIS EXISTS:
 * The stream route sent no `ETag`, `Last-Modified` or `Cache-Control` at all,
 * so every response was uncacheable by default. Scrubbing backwards in a video
 * the browser had *already downloaded* re-issued the range over the network and
 * re-read it from disk, because nothing told the browser it was allowed to keep
 * what it had. Validators plus a max-age turn a backward seek into a cache hit.
 *
 * @param {import('fs').Stats} stat
 * @returns {{etag: string, lastModified: string}}
 */
export function buildValidators(stat) {
  // Second-resolution, because that is all `Last-Modified` can express — if the
  // two disagreed, a client validating with `If-Modified-Since` and one
  // validating with `If-None-Match` could get different answers for the same
  // file. Size is included so a same-second rewrite of a different length still
  // busts the tag.
  const mtimeSecs = Math.floor(stat.mtimeMs / 1000);
  return {
    etag: `"${stat.size.toString(16)}-${mtimeSecs.toString(16)}"`,
    lastModified: new Date(mtimeSecs * 1000).toUTCString(),
  };
}

/** Weak comparison per RFC 7232 §2.3.2: ignore any `W/` prefix. */
function etagMatches(candidate, etag) {
  const normalise = (t) => t.trim().replace(/^W\//, '');
  return normalise(candidate) === normalise(etag);
}

/**
 * Evaluate `If-None-Match` / `If-Modified-Since` / `If-Range` for this request.
 *
 * @param {Request} req
 * @param {{etag: string, lastModified: string}} validators
 * @param {boolean} hasRange Whether a range was parsed for this request.
 * @returns {{notModified: boolean, ignoreRange: boolean}}
 *   - `notModified` — respond 304 with no body (never set when a range was asked
 *     for; a 304 to a range request would be answering a question the client
 *     didn't ask).
 *   - `ignoreRange` — the entity changed since the client got its first chunk,
 *     so serve the whole thing with 200 rather than splicing a fresh range into
 *     a stale buffer.
 */
export function evaluateConditional(req, validators, hasRange) {
  const { etag, lastModified } = validators;

  // If-Range guards the range itself: when it doesn't match, RFC 7233 §3.2 says
  // to ignore the Range header and return the full entity.
  if (hasRange) {
    const ifRange = req.headers.get('if-range');
    if (ifRange) {
      const trimmed = ifRange.trim();
      // An If-Range value is either an entity-tag or an HTTP-date.
      const matches = trimmed.startsWith('"') || trimmed.startsWith('W/')
        ? etagMatches(trimmed, etag)
        : trimmed === lastModified;
      if (!matches) return { notModified: false, ignoreRange: true };
    }
    return { notModified: false, ignoreRange: false };
  }

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) {
    const fresh =
      ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((t) => etagMatches(t, etag));
    return { notModified: fresh, ignoreRange: false };
  }

  const ifModifiedSince = req.headers.get('if-modified-since');
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    const modified = Date.parse(lastModified);
    if (Number.isFinite(since) && Number.isFinite(modified) && modified <= since) {
      return { notModified: true, ignoreRange: false };
    }
  }

  return { notModified: false, ignoreRange: false };
}
