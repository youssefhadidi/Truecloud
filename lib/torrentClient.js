/** @format */

/**
 * Torrent microservice HTTP client.
 * Replaces direct webTorrentManager imports in API routes.
 * Talks to the torrent-service running on Node.js at TORRENT_SERVICE_URL.
 */

const BASE_URL = process.env.TORRENT_SERVICE_URL || 'http://localhost:9669';
const FETCH_TIMEOUT_MS = 30_000;

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
      ...options,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Torrent service request timed out');
    throw new Error(`Torrent service unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Torrent service returned unexpected response (HTTP ${res.status})`);
  }

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

/**
 * Finished downloads the service keeps as history.
 * They are deliberately absent from the active/waiting lists, so the file
 * browser keeps showing the real file rather than a torrent row.
 */
export async function getCompletedDownloads(filterPath = null) {
  const params = filterPath != null ? `?path=${encodeURIComponent(filterPath)}` : '';
  return apiFetch(`/downloads/completed${params}`);
}

/** Dismiss the whole history. Never deletes downloaded files. */
export async function clearCompletedDownloads() {
  const data = await apiFetch('/downloads/completed', { method: 'DELETE' });
  return data.cleared || 0;
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

/**
 * Remove a download. The service decides what that means for the files: a
 * finished download is only dismissed, an unfinished one has its partial data
 * deleted. Returns { success, filesDeleted } so callers can say which happened.
 */
export async function removeDownload(gid) {
  return apiFetch(`/downloads/${encodeURIComponent(gid)}`, {
    method: 'DELETE',
  });
}

export async function testTrackerConnectivity(trackerUrl) {
  return apiFetch(`/tracker/test?url=${encodeURIComponent(trackerUrl)}`);
}
