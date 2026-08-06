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
