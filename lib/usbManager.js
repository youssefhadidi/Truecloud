/** @format */

/**
 * USB Drive Manager
 *
 * Detects removable/USB block devices and their mounted partitions, and
 * broadcasts changes over the unified WebSocket as
 * { type: 'usb-drives', payload: [...drives] }.
 *
 * Primary detection: `udevadm monitor --subsystem-match=block --udev` child
 * process, event-driven (no polling).
 * Fallback: periodic `lsblk` if udevadm can't be spawned.
 *
 * Auto-mounting is delegated to the OS (udisks/polkit). A partition only
 * shows up as browsable here once it has a `mountpoint`.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FALLBACK_POLL_MS = 3000;
// After a udev event, udisks auto-mount runs asynchronously. Rescan a few
// times to catch the mountpoint appearing.
const RESCAN_DELAYS_MS = [200, 1000, 3000];

const isLinux = process.platform === 'linux';

let udevProc = null;
let fallbackInterval = null;
let started = false;

let currentDrives = [];
let lastSerialized = '[]';

let debounceHandle = null;
let scheduledTimers = new Set();

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

function isUsbLike(dev) {
  if (dev.tran === 'usb') return true;
  if (toBool(dev.hotplug) && toBool(dev.rm)) return true;
  return false;
}

function pickPartitions(children) {
  if (!Array.isArray(children)) return [];
  return children
    .filter((p) => p.type === 'part' && p.fstype && !['swap', 'crypto_LUKS'].includes(p.fstype))
    .map((p) => ({
      name: p.name,
      path: p.path || `/dev/${p.name}`,
      size: typeof p.size === 'number' ? p.size : Number(p.size) || 0,
      label: p.label || null,
      uuid: p.uuid || null,
      fstype: p.fstype,
      mountpoint: p.mountpoint || null,
    }));
}

async function listUsbDrives() {
  if (!isLinux) return [];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'lsblk',
      ['-J', '-b', '-o', 'NAME,PATH,TYPE,TRAN,SIZE,LABEL,UUID,FSTYPE,MOUNTPOINT,HOTPLUG,RM,VENDOR,MODEL'],
      { timeout: 5000 },
    ));
  } catch (err) {
    console.error('[USB] lsblk failed:', err.message);
    return [];
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }

  const drives = [];
  for (const dev of data.blockdevices || []) {
    if (dev.type !== 'disk') continue;
    if (!isUsbLike(dev)) continue;
    const partitions = pickPartitions(dev.children);
    drives.push({
      name: dev.name,
      path: dev.path || `/dev/${dev.name}`,
      size: typeof dev.size === 'number' ? dev.size : Number(dev.size) || 0,
      vendor: (dev.vendor || '').trim() || null,
      model: (dev.model || '').trim() || null,
      transport: dev.tran || null,
      partitions,
    });
  }
  return drives;
}

export function getUsbDrives() {
  return currentDrives;
}

export function getMountpoints() {
  const set = new Set();
  for (const d of currentDrives) {
    for (const p of d.partitions) {
      if (p.mountpoint) set.add(p.mountpoint);
    }
  }
  return set;
}

async function scan() {
  const drives = await listUsbDrives();
  const serialized = JSON.stringify(drives);
  if (serialized !== lastSerialized) {
    lastSerialized = serialized;
    currentDrives = drives;
    if (typeof global.broadcastUsbDrives === 'function') {
      global.broadcastUsbDrives(drives);
    }
  }
}

function triggerRescan() {
  // Debounce bursts of events (a single plug-in fires several), then run a
  // few staggered scans to catch the udisks auto-mount once it finishes.
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    debounceHandle = null;
    scan().catch((e) => console.error('[USB] Scan error:', e.message));
    for (const delay of RESCAN_DELAYS_MS) {
      const t = setTimeout(() => {
        scheduledTimers.delete(t);
        scan().catch((e) => console.error('[USB] Rescan error:', e.message));
      }, delay);
      scheduledTimers.add(t);
    }
  }, 150);
}

function startUdevMonitor() {
  try {
    udevProc = spawn('udevadm', ['monitor', '--subsystem-match=block', '--udev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error('[USB] Failed to spawn udevadm:', err.message);
    return false;
  }

  udevProc.stdout.on('data', () => triggerRescan());
  udevProc.stderr.on('data', () => {});

  udevProc.on('error', (err) => {
    console.error('[USB] udevadm error, falling back to polling:', err.message);
    udevProc = null;
    if (started) startPolling();
  });

  udevProc.on('exit', (code, signal) => {
    udevProc = null;
    if (started && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[USB] udevadm exited (code=${code}, signal=${signal}), falling back to polling`);
      startPolling();
    }
  });

  return true;
}

function startPolling() {
  if (fallbackInterval) return;
  fallbackInterval = setInterval(() => {
    scan().catch((e) => console.error('[USB] Poll scan error:', e.message));
  }, FALLBACK_POLL_MS);
}

export function startUsbManager() {
  if (started || !isLinux) return;
  started = true;

  scan().catch((e) => console.error('[USB] Initial scan error:', e.message));

  if (!startUdevMonitor()) {
    startPolling();
  }
}

export function stopUsbManager() {
  started = false;
  if (debounceHandle) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
  for (const t of scheduledTimers) clearTimeout(t);
  scheduledTimers.clear();
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
  if (udevProc) {
    try { udevProc.kill('SIGTERM'); } catch {}
    udevProc = null;
  }
}
