/** @format */

'use client';

import { useSyncExternalStore } from 'react';

// Per-folder PIN cache for unlocking passcode-protected folders. Lives in
// memory only (no localStorage / sessionStorage) and is keyed by the lock
// path — so multiple locked folders can be unlocked concurrently and each
// API call (or download URL) picks up the PIN that matches its target.
//
// Both React components (via useFolderPins) and non-React callers (the axios
// request interceptor in lib/axiosConfig.js) read from this same module so
// they stay in sync without prop drilling.

const pins = new Map(); // lockPath -> pin
const listeners = new Set();
let snapshot = pins;

function emit() {
  // useSyncExternalStore uses Object.is on the snapshot to decide whether to
  // re-render. Re-creating the Map cheaply gives us a new identity.
  snapshot = new Map(pins);
  for (const cb of listeners) cb();
}

function normalize(path) {
  if (typeof path !== 'string') return '';
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export function setFolderPin(lockPath, pin) {
  const key = normalize(lockPath);
  if (!key || !pin) return;
  if (pins.get(key) === pin) return;
  pins.set(key, pin);
  emit();
}

export function clearFolderPin(lockPath) {
  const key = normalize(lockPath);
  if (!key || !pins.has(key)) return;
  pins.delete(key);
  emit();
}

export function clearAllFolderPins() {
  if (pins.size === 0) return;
  pins.clear();
  emit();
}

// Return the PIN whose lock path is the nearest ancestor of `targetPath`
// (or `===` it). Mirrors lib/folderLocks.js#findAncestorLockPath so the
// client picks the same lock the server would gate on.
export function getFolderPinForPath(targetPath) {
  const n = normalize(targetPath);
  if (!n || pins.size === 0) return null;
  let bestPath = null;
  for (const lp of pins.keys()) {
    if (lp === n || n.startsWith(lp + '/')) {
      if (bestPath === null || lp.length > bestPath.length) bestPath = lp;
    }
  }
  return bestPath ? pins.get(bestPath) : null;
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return snapshot;
}

export function useFolderPins() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Non-React accessor for the axios request interceptor. Returns the live
// snapshot Map — read-only by convention; never mutate.
export function getAllFolderPinsForInterceptor() {
  return snapshot;
}

// Append `&folderPin=XXXX` (or `?folderPin=XXXX`) to a same-origin URL when
// `targetPath` is inside an unlocked folder. Used for browser-native fetches
// (anchor downloads, video src, img src) where custom headers can't be set.
export function appendFolderPinToUrl(url, targetPath) {
  const pin = getFolderPinForPath(targetPath);
  if (!pin) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}folderPin=${encodeURIComponent(pin)}`;
}
