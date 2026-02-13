/** @format */

/**
 * Stub module for webtorrent during build time
 * At runtime, the real webtorrent module is lazily loaded
 */

export default class WebTorrentStub {
  constructor() {
    throw new Error('WebTorrent stub should not be instantiated at build time. Use runtime lazy loading instead.');
  }
}
