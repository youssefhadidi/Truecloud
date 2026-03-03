/**
 * Torrent Process Manager (Bun side)
 *
 * Spawns lib/torrentWorker.mjs in a plain Node.js child process to avoid
 * Bun's ESM-CJS interop issue with node-datachannel native addons.
 *
 * Communication: newline-delimited JSON over stdio.
 *   stdin  → { id, method, params[] }           (commands to worker)
 *   stdout ← { id, result } | { id, error }     (command responses)
 *   stdout ← { type: 'torrent-event', payload }  (push events → WebSocket broadcast)
 *   stderr ← log lines (inherited, appear in parent console)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'torrentWorker.mjs');
const PROJECT_ROOT = path.join(__dirname, '..');

let proc = null;
const pendingRequests = new Map();
let nextId = 1;

function startWorker() {
  proc = spawn('node', [WORKER_PATH], {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout piped, stderr forwarded to parent
    cwd: PROJECT_ROOT,
  });

  // Use raw data events instead of readline — Bun's readline polyfill can drop
  // lines from a continuously-streaming child process stdout pipe.
  let stdoutBuf = '';
  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let newline;
    while ((newline = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, newline).trim();
      stdoutBuf = stdoutBuf.slice(newline + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.id !== undefined) {
        // Response to a command
        const pending = pendingRequests.get(msg.id);
        if (!pending) continue;
        pendingRequests.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
      } else if (msg.type === 'torrent-event') {
        // Forward progress events to Bun's WebSocket broadcast
        if (global.broadcastTorrentDownloadUpdate) {
          global.broadcastTorrentDownloadUpdate(msg.payload);
        }
      }
    }
  });

  proc.on('exit', (code, signal) => {
    console.error(`> [torrent-worker] exited (code=${code} signal=${signal}), restarting in 3s…`);
    // Reject all in-flight requests so callers don't hang
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error('Torrent worker process exited unexpectedly'));
    }
    pendingRequests.clear();
    proc = null;
    setTimeout(startWorker, 3000);
  });

  proc.on('error', (err) => {
    console.error('> [torrent-worker] spawn error:', err.message);
  });

  console.log('> Torrent worker started (Node.js child process)');
}

function send(method, params = []) {
  return new Promise((resolve, reject) => {
    if (!proc || proc.killed) {
      return reject(new Error('Torrent worker is not running'));
    }
    const id = nextId++;
    pendingRequests.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

startWorker();

export const addDownload             = (url, options = {})                      => send('addDownload', [url, options]);
export const getActiveDownloads      = (filterPath = null)                      => send('getActiveDownloads', [filterPath]);
export const getWaitingDownloads     = (offset = 0, num = 100, filterPath = null) => send('getWaitingDownloads', [offset, num, filterPath]);
export const pauseDownload           = (gid)                                    => send('pauseDownload', [gid]);
export const resumeDownload          = (gid)                                    => send('resumeDownload', [gid]);
export const removeDownload          = (gid)                                    => send('removeDownload', [gid]);
export const getDownloadStatus       = (gid)                                    => send('getDownloadStatus', [gid]);
export const testTrackerConnectivity = (trackerUrl)                             => send('testTrackerConnectivity', [trackerUrl]);
