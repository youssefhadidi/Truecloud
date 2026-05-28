/** @format */

import { createScanner } from './storageScanner.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Per-user scan state. One scan runs per admin userId; additional sockets
// for the same user share that scan and receive identical snapshots.
//
// Shape: Map<userId, {
//   scanner: EventEmitter,
//   abortController: AbortController,
//   subscribers: Set<WebSocket>,
//   lastSnapshot: object | null,
//   startMsg: object | null,
//   done: boolean,
// }>
const scans = new Map();

function send(ws, payload) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'storage-scan', payload }));
}

function broadcast(state, payload) {
  state.subscribers.forEach((ws) => send(ws, payload));
}

function startScan(userId) {
  const abortController = new AbortController();
  const scanner = createScanner(UPLOAD_DIR, abortController.signal);

  const state = {
    scanner,
    abortController,
    subscribers: new Set(),
    lastSnapshot: null,
    startMsg: null,
    done: false,
  };

  scanner.on('start', (msg) => {
    state.startMsg = msg;
    broadcast(state, msg);
  });
  scanner.on('progress', (msg) => {
    state.lastSnapshot = msg;
    broadcast(state, msg);
  });
  scanner.on('done', (msg) => {
    state.done = true;
    // Capture a final snapshot if the walker hasn't flushed one yet
    // (e.g. an empty tree). Lets late subscribers see the totals.
    if (!state.lastSnapshot) state.lastSnapshot = scanner.snapshot();
    broadcast(state, msg);
  });
  scanner.on('error', (msg) => {
    broadcast(state, msg);
  });

  return state;
}

export function addSubscriber(ws) {
  const userId = ws.userId;
  if (!userId) {
    send(ws, { event: 'denied', reason: 'no-user' });
    return;
  }

  let state = scans.get(userId);
  if (!state) {
    state = startScan(userId);
    scans.set(userId, state);
  }

  state.subscribers.add(ws);

  // Replay current state to this socket so a second tab / reconnect
  // catches up immediately without restarting the walker.
  if (state.startMsg) send(ws, state.startMsg);
  if (state.lastSnapshot) send(ws, state.lastSnapshot);
  if (state.done && state.lastSnapshot) {
    // The 'done' message itself is small; reissue so the UI flips status.
    send(ws, {
      event: 'done',
      totalBytes: state.lastSnapshot.totalBytes,
      filesScanned: state.lastSnapshot.filesScanned,
      durationMs: 0,
    });
  }
}

export function removeSubscriber(ws) {
  const userId = ws.userId;
  if (!userId) return;
  const state = scans.get(userId);
  if (!state) return;
  state.subscribers.delete(ws);
  if (state.subscribers.size === 0) {
    state.abortController.abort();
    scans.delete(userId);
  }
}
