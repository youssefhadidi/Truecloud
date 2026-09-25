/** @format */

class LRUCache {
  #map = new Map();
  #currentBytes = 0;
  #maxBytes;
  #maxEntryBytes;

  /**
   * @param {number} maxBytes Total budget
   * @param {number} [maxEntryBytes] Larger buffers aren't cached at all, so
   *   one big entry can't evict hundreds of small ones.
   */
  constructor(maxBytes, maxEntryBytes = maxBytes) {
    this.#maxBytes = maxBytes;
    this.#maxEntryBytes = maxEntryBytes;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key, buffer) {
    if (this.#map.has(key)) {
      this.#currentBytes -= this.#map.get(key).length;
      this.#map.delete(key);
    }
    if (buffer.length > this.#maxEntryBytes) return;
    // Evict oldest until we have room
    while (this.#currentBytes + buffer.length > this.#maxBytes && this.#map.size > 0) {
      const oldest = this.#map.keys().next().value;
      this.#currentBytes -= this.#map.get(oldest).length;
      this.#map.delete(oldest);
    }
    this.#map.set(key, buffer);
    this.#currentBytes += buffer.length;
  }

  invalidate(key) {
    if (this.#map.has(key)) {
      this.#currentBytes -= this.#map.get(key).length;
      this.#map.delete(key);
    }
  }

  clear() {
    this.#map.clear();
    this.#currentBytes = 0;
  }
}

// Separate budgets: grid thumbnails are small (tens of KB) and requested by the
// hundred on every folder view, while viewer-size images are hundreds of KB
// each. Sharing one budget let a few hundred photos paged through in the viewer
// evict every grid thumbnail back to disk.
export const thumbnailCache = new LRUCache(96 * 1024 * 1024);
export const optimizedImageCache = new LRUCache(128 * 1024 * 1024, 8 * 1024 * 1024);
