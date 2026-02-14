/**
 * Log Stream Manager
 *
 * Manages real-time log streaming via WebSocket.
 * Periodically checks for new log lines and broadcasts them to all connected clients.
 *
 * Message format:
 * { type: 'logs', payload: { newLines: [...], allLines: [...], offset: number } }
 */

const { readFile, writeFile } = require('fs/promises');
const { resolve } = require('path');
const { existsSync } = require('fs');

const STATE_FILE = resolve(process.cwd(), '.logs-state.json');
const HISTORY_FILE = resolve(process.cwd(), '.logs-history.json');
const LOG_PATHS = [
  '/var/log/truecloud/output.log',
  resolve(process.cwd(), '.next/logs/server.log'),
  resolve(process.cwd(), 'logs/app.log'),
  resolve(process.cwd(), 'app.log'),
];

let logStreamInterval = null;
let lastKnownOffset = 0;
let lastKnownPath = null;

async function getLogState() {
  try {
    if (existsSync(STATE_FILE)) {
      const content = await readFile(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return default state if file doesn't exist or is invalid
  }
  return { lastOffset: 0, lastPath: null };
}

async function saveLogState(path, offset) {
  try {
    await writeFile(STATE_FILE, JSON.stringify({ lastOffset: offset, lastPath: path }, null, 2));
  } catch (error) {
    console.error('[LOGS] Failed to save log state:', error);
  }
}

async function getLogHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = await readFile(HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty history if file doesn't exist or is invalid
  }
  return { lines: [] };
}

async function appendToHistory(newLines) {
  try {
    const history = await getLogHistory();
    history.lines.push(...newLines);
    await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('[LOGS] Failed to append to history:', error);
  }
}

async function checkAndBroadcastNewLogs() {
  try {
    let logPath = null;
    let logContent = '';

    // Find which log file exists
    for (const path of LOG_PATHS) {
      try {
        logContent = await readFile(path, 'utf-8');
        logPath = path;
        break;
      } catch {
        continue;
      }
    }

    if (!logPath) {
      return;
    }

    // Get stored state
    const state = await getLogState();
    const history = await getLogHistory();

    // Check if there are new lines
    let newLines = [];
    let newOffset = logContent.length;

    if (state.lastPath === logPath && state.lastOffset < logContent.length) {
      // Only get new content since last read
      const newContent = logContent.slice(state.lastOffset);
      newLines = newContent
        .split('\n')
        .filter(line => line.trim());
    } else if (state.lastPath !== logPath) {
      // Different log file, return all
      newLines = logContent
        .split('\n')
        .filter(line => line.trim());
    }

    // If there are new lines, append to history and broadcast
    if (newLines.length > 0) {
      await appendToHistory(newLines);

      // Broadcast to all connected WebSocket clients
      if (global.broadcastLogs) {
        global.broadcastLogs({
          newLines,
          allLines: [...history.lines, ...newLines],
          offset: newOffset,
          logPath,
        });
      }
    }

    // Save new state
    await saveLogState(logPath, newOffset);
  } catch (error) {
    console.error('[LOGS] Error checking logs:', error);
  }
}

/**
 * Start the log stream manager
 * Checks for new logs every 1 second
 */
function startLogStream() {
  if (logStreamInterval) {
    return; // Already running
  }

  console.log('[LOGS] Starting log stream manager');

  // Check immediately on start
  checkAndBroadcastNewLogs();

  // Then check every second
  logStreamInterval = setInterval(checkAndBroadcastNewLogs, 1000);
}

/**
 * Stop the log stream manager
 */
function stopLogStream() {
  if (logStreamInterval) {
    console.log('[LOGS] Stopping log stream manager');
    clearInterval(logStreamInterval);
    logStreamInterval = null;
  }
}

module.exports = { startLogStream, stopLogStream };
