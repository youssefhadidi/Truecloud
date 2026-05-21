/**
 * Log Stream Manager
 *
 * Streams real-time log file appends to WebSocket subscribers.
 *
 * Subscription-based: the 1s polling loop only runs while at least one
 * client is subscribed to the `logs` channel. server.js calls
 * startLogStream / stopLogStream as subscribers come and go.
 *
 * No history is stored or replayed. When polling starts, the offset is
 * pinned to the current end of the active log file so subscribers only
 * see lines written from that moment forward — they build their own
 * scrollback from the delta stream.
 *
 * Each tick emits one or more messages:
 *   { type: 'logs', payload: { newLines, offset, logPath } }
 * Bursts larger than MAX_BROADCAST_BYTES are split across multiple
 * messages so no single WS frame balloons.
 */

const { readFile, stat } = require('fs/promises');
const { resolve } = require('path');

const LOG_PATHS = [
  '/var/log/truecloud/output.log',
  resolve(process.cwd(), '.next/logs/server.log'),
  resolve(process.cwd(), 'logs/app.log'),
  resolve(process.cwd(), 'app.log'),
];

// Cap WS payload size for log broadcasts. A single frame carrying hundreds
// of KB of log text stalls the socket and inflates client memory.
const MAX_BROADCAST_BYTES = 64 * 1024;

let logStreamInterval = null;
let lastOffset = 0;
let lastPath = null;

async function findActiveLogPath() {
  for (const path of LOG_PATHS) {
    try {
      await stat(path);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

function chunkLinesByBytes(lines, maxBytes = MAX_BROADCAST_BYTES) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(String(line), 'utf-8') + 6; // JSON overhead per element
    if (current.length > 0 && currentBytes + lineBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(line);
    currentBytes += lineBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function checkAndBroadcastNewLogs() {
  try {
    const logPath = await findActiveLogPath();
    if (!logPath) return;

    const content = await readFile(logPath, 'utf-8');

    // First read after (re)start, or log file rotated: pin to end and emit nothing.
    if (lastPath !== logPath) {
      lastPath = logPath;
      lastOffset = content.length;
      return;
    }

    // File truncated in place: reset and emit nothing.
    if (content.length < lastOffset) {
      lastOffset = content.length;
      return;
    }

    if (content.length === lastOffset) return;

    const newContent = content.slice(lastOffset);
    lastOffset = content.length;

    const newLines = newContent.split('\n').filter((line) => line.length > 0);
    if (newLines.length === 0) return;

    if (typeof global.broadcastLogs !== 'function') return;

    for (const chunk of chunkLinesByBytes(newLines)) {
      global.broadcastLogs({
        newLines: chunk,
        offset: lastOffset,
        logPath,
      });
    }
  } catch (error) {
    console.error('[LOGS] Error checking logs:', error);
  }
}

/**
 * Start the poller. Called by server.js when the first WS client subscribes
 * to the `logs` channel. No-op if already running.
 */
async function startLogStream() {
  if (logStreamInterval) return;
  console.log('[LOGS] Starting log stream manager');

  // Pin the offset to end-of-file so we don't replay anything that was
  // written before the first subscriber attached.
  const logPath = await findActiveLogPath();
  if (logPath) {
    try {
      const { size } = await stat(logPath);
      lastPath = logPath;
      lastOffset = size;
    } catch {
      lastPath = null;
      lastOffset = 0;
    }
  }

  logStreamInterval = setInterval(checkAndBroadcastNewLogs, 1000);
}

function stopLogStream() {
  if (logStreamInterval) {
    console.log('[LOGS] Stopping log stream manager');
    clearInterval(logStreamInterval);
    logStreamInterval = null;
  }
}

module.exports = { startLogStream, stopLogStream, chunkLinesByBytes, MAX_BROADCAST_BYTES };
