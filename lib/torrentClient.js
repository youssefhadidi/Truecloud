/** @format */

/**
 * Torrent microservice HTTP client.
 * Replaces direct webTorrentManager imports in API routes.
 * Talks to the torrent-service running on Node.js at TORRENT_SERVICE_URL.
 */

const BASE_URL = process.env.TORRENT_SERVICE_URL || 'http://localhost:9669';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function addDownload(url, options = {}) {
  const data = await apiFetch('/downloads', {
    method: 'POST',
    body: JSON.stringify({
      url,
      dir: options.dir,
      relativePath: options.relativePath,
      paused: options.paused,
    }),
  });
  return data.gid;
}

export async function getActiveDownloads(filterPath = null) {
  const params = filterPath != null ? `?path=${encodeURIComponent(filterPath)}` : '';
  return apiFetch(`/downloads/active${params}`);
}

export async function getWaitingDownloads(offset = 0, num = 100, filterPath = null) {
  const params = new URLSearchParams({ offset, num });
  if (filterPath != null) params.set('path', filterPath);
  return apiFetch(`/downloads/waiting?${params}`);
}

export async function getDownloadStatus(gid) {
  return apiFetch(`/downloads/${encodeURIComponent(gid)}`);
}

export async function pauseDownload(gid) {
  await apiFetch(`/downloads/${encodeURIComponent(gid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'pause' }),
  });
  return true;
}

export async function resumeDownload(gid) {
  await apiFetch(`/downloads/${encodeURIComponent(gid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'resume' }),
  });
  return true;
}

export async function removeDownload(gid) {
  await apiFetch(`/downloads/${encodeURIComponent(gid)}`, {
    method: 'DELETE',
  });
  return true;
}

export async function testTrackerConnectivity(trackerUrl) {
  return apiFetch(`/tracker/test?url=${encodeURIComponent(trackerUrl)}`);
}
