/** @format */

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

class LRUCache {
  #map = new Map();
  #currentBytes = 0;

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
    // Evict oldest until we have room
    while (this.#currentBytes + buffer.length > MAX_BYTES && this.#map.size > 0) {
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

export const thumbnailCache = new LRUCache();
