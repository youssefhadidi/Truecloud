/**
 * Torrent Manager Proxy
 *
 * Thin proxy that delegates to the torrent microservice client loaded by server.js.
 * server.js imports torrentClient.js in an unbundled Bun context and stores it on
 * globalThis so Turbopack-bundled API routes can reach it at runtime without
 * Turbopack trying to bundle the fetch-based client itself.
 */

function getManager() {
  if (!globalThis.torrentClient) {
    throw new Error('Torrent service client is not available. Is the torrent microservice running?');
  }
  return globalThis.torrentClient;
}

export async function testTrackerConnectivity(trackerUrl) {
  return getManager().testTrackerConnectivity(trackerUrl);
}

export async function addDownload(url, options = {}) {
  return getManager().addDownload(url, options);
}

export async function getDownloadStatus(gid) {
  return getManager().getDownloadStatus(gid);
}

export async function getActiveDownloads(filterPath = null) {
  return getManager().getActiveDownloads(filterPath);
}

export async function getWaitingDownloads(offset = 0, num = 100, filterPath = null) {
  return getManager().getWaitingDownloads(offset, num, filterPath);
}

export async function pauseDownload(gid) {
  return getManager().pauseDownload(gid);
}

export async function resumeDownload(gid) {
  return getManager().resumeDownload(gid);
}

export async function removeDownload(gid) {
  return getManager().removeDownload(gid);
}
