/**
 * Torrent Manager Proxy
 *
 * Thin proxy that delegates to the webTorrentManager instance loaded by server.js.
 * server.js loads webTorrentManager in an unbundled Bun context where the native
 * node-datachannel addon resolves its file path correctly. That instance is stored
 * in global.torrentManager and accessed here, avoiding Turbopack bundling the
 * native module and losing path context ('from ''' error).
 */

function getManager() {
  if (!globalThis.torrentProcess) {
    throw new Error('WebTorrent manager is not available. Check server logs for load errors.');
  }
  return globalThis.torrentProcess;
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
