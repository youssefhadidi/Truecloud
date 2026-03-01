/** @format */

// Semaphore for limiting concurrent operations
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  /**
   * Acquire a slot. Blocks until one is available.
   * @param {number} [weight=1]
   * @param {AbortSignal} [signal] - if aborted while waiting, the acquire
   *   rejects with a DOMException('AbortError') and the queued entry is
   *   discarded so it never consumes a slot when it eventually would have run.
   */
  async acquire(weight = 1, signal) {
    if (this.count + weight <= this.max) {
      this.count += weight;
      return weight;
    }
    return new Promise((resolve, reject) => {
      const entry = { weight, resolve, reject };
      this.queue.push(entry);

      if (signal) {
        const onAbort = () => {
          // Remove from queue so this entry never consumes a slot
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new DOMException('Semaphore acquire aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        // Clean up the abort listener if we resolve normally
        const origResolve = entry.resolve;
        entry.resolve = (v) => {
          signal.removeEventListener('abort', onAbort);
          origResolve(v);
        };
      }
    }).then(() => weight);
  }

  release(weight = 1) {
    this.count -= weight;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (this.count + next.weight > this.max) break;
      this.queue.shift();
      this.count += next.weight;
      next.resolve();
    }
  }
}
