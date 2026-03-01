/** @format */

import { Readable } from 'stream';

/**
 * Wraps a Node.js Readable stream in a Web ReadableStream using the official
 * Node.js implementation (stream.Readable.toWeb).
 *
 * WHY NOT A CUSTOM PUSH-BASED WRAPPER:
 * A push-based wrapper (using .on('data', ...) / flowing mode) causes two
 * problems with concurrent downloads:
 *
 * 1. NO BACKPRESSURE: all streams read from disk at maximum speed simultaneously
 *    regardless of whether the HTTP/TCP layer is ready to consume the data.
 *    Chunks pile up in the Web ReadableStream's internal queue, bloating memory.
 *
 * 2. GC SPIKE ON CANCEL: when a download is cancelled, all buffered chunks
 *    for that stream are freed at once. V8's garbage collector must reclaim
 *    the memory (up to highWaterMark per stream) in a stop-the-world pause,
 *    during which the event loop is frozen and all other downloads flatline to 0.
 *
 * WHY Readable.toWeb():
 * The official implementation is PULL-based. It only calls fs.read() when the
 * consumer (Next.js HTTP layer → TCP send buffer) explicitly requests the next
 * chunk via the ReadableStream pull() callback. This means:
 *   - Memory usage per download stays at ~1 chunk at a time
 *   - Cancelling a download frees at most one in-flight chunk
 *   - GC pressure is negligible; other downloads are unaffected
 *   - Double-close / client-disconnect edge cases are handled by Node.js
 *
 * @param {import('stream').Readable} nodeStream
 * @returns {ReadableStream}
 */
export function nodeToWebStream(nodeStream) {
  return Readable.toWeb(nodeStream);
}
