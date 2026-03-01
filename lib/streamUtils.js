/** @format */

/**
 * Wraps a Node.js Readable stream in a Web ReadableStream.
 *
 * When a client disconnects (seek, pause, tab close), the HTTP layer closes
 * the ReadableStream controller. If the underlying Node.js stream then emits
 * 'end' or 'error', calling controller.close/error a second time throws
 * ERR_INVALID_STATE ("ReadableStream is already closed"), which surfaces as an
 * uncaughtException and crashes the process.
 *
 * This wrapper swallows the harmless double-close by catching all controller
 * calls, and destroys the Node.js stream when the consumer cancels.
 *
 * @param {import('stream').Readable} nodeStream
 * @returns {ReadableStream}
 */
export function nodeToWebStream(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Controller already closed (client disconnected) — stop reading
          nodeStream.destroy();
        }
      });

      nodeStream.on('end', () => {
        try {
          controller.close();
        } catch {
          // Already closed by client disconnect — not an error
        }
      });

      nodeStream.on('error', (err) => {
        try {
          controller.error(err);
        } catch {
          // Already closed — nothing to do
        }
      });
    },

    cancel() {
      nodeStream.destroy();
    },
  });
}
