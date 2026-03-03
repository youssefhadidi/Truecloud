/**
 * Torrent Service Client
 *
 * Fetch-based HTTP client for the torrent microservice (torrent-service/index.mjs).
 * Exports the same API surface as the old torrentWorker stdio bridge so that
 * torrentManagerProxy.js can swap implementations without changing callers.
 *
 * Configure via environment:
 *   TORRENT_SERVICE_URL  Base URL of the torrent service (default: http://localhost:9669)
 */

const BASE_URL = process.env.TORRENT_SERVICE_URL || 'http://localhost:9669';

async function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export const addDownload = (url, options = {}) =>
  api('POST', '/downloads', {
    url,
    dir: options.dir,
    relativePath: options.relativePath,
    paused: options.paused,
  }).then((r) => r.gid);

export const getActiveDownloads = (filterPath = null) => {
  const qs = filterPath != null ? `?path=${encodeURIComponent(filterPath)}` : '';
  return api('GET', `/downloads/active${qs}`);
};

export const getWaitingDownloads = (offset = 0, num = 100, filterPath = null) => {
  const params = new URLSearchParams({ offset: String(offset), num: String(num) });
  if (filterPath != null) params.set('path', filterPath);
  return api('GET', `/downloads/waiting?${params}`);
};

export const getDownloadStatus = (gid) =>
  api('GET', `/downloads/${encodeURIComponent(gid)}`).catch(() => null);

export const pauseDownload = (gid) =>
  api('PATCH', `/downloads/${encodeURIComponent(gid)}`, { action: 'pause' });

export const resumeDownload = (gid) =>
  api('PATCH', `/downloads/${encodeURIComponent(gid)}`, { action: 'resume' });

export const removeDownload = (gid) =>
  api('DELETE', `/downloads/${encodeURIComponent(gid)}`);

export const testTrackerConnectivity = (trackerUrl) =>
  api('GET', `/tracker/test?url=${encodeURIComponent(trackerUrl)}`);
