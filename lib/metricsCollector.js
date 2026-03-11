/** @format */

import { readFile } from 'fs/promises';
import os from 'os';

const INTERVAL_MS = 2000;
const ZFS_INTERVAL_TICKS = 5; // refresh ZFS every 10s (5 × 2s)

let prevCpuStats = null;
let prevNetStats = null;
let prevDiskStats = null;
let cachedZfsPools = [];
let zfsTickCount = 0;
let intervalId = null;
const isLinux = process.platform === 'linux';

// ─── /proc parsers ────────────────────────────────────────────────────────────

async function parseProcStat() {
  const content = await readFile('/proc/stat', 'utf8');
  return content
    .split('\n')
    .filter((l) => l.startsWith('cpu'))
    .map((line) => {
      const parts = line.split(/\s+/);
      const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts
        .slice(1)
        .map(Number);
      const total = user + nice + system + idle + iowait + irq + softirq + steal;
      return { name: parts[0], idle, total };
    });
}

async function parseProcNetDev() {
  const content = await readFile('/proc/net/dev', 'utf8');
  const result = {};
  for (const line of content.split('\n').slice(2)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const iface = trimmed.slice(0, colonIdx).trim();
    const parts = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
    result[iface] = {
      rxBytes: parseInt(parts[0], 10) || 0,
      txBytes: parseInt(parts[8], 10) || 0,
    };
  }
  return result;
}

async function parseProcDiskStats() {
  const content = await readFile('/proc/diskstats', 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const name = parts[2];
    // Keep whole disks: sda, nvme0n1, vda, etc. — skip partitions like sda1, nvme0n1p1
    if (/^(sd|hd|vd|xvd)[a-z]$/.test(name) || /^nvme\d+n\d+$/.test(name) || /^mmcblk\d+$/.test(name)) {
      result[name] = {
        readSectors: parseInt(parts[5], 10) || 0,
        writeSectors: parseInt(parts[9], 10) || 0,
      };
    }
  }
  return result;
}

async function parseProcMeminfo() {
  try {
    const content = await readFile('/proc/meminfo', 'utf8');
    const get = (key) => {
      const line = content.split('\n').find((l) => l.startsWith(key));
      return line ? parseInt(line.split(/\s+/)[1], 10) * 1024 : 0;
    };
    return {
      swapTotal: get('SwapTotal:'),
      swapFree: get('SwapFree:'),
    };
  } catch {
    return { swapTotal: 0, swapFree: 0 };
  }
}

async function getCpuFreqs() {
  try {
    const content = await readFile('/proc/cpuinfo', 'utf8');
    return content
      .split('\n')
      .filter((l) => l.startsWith('cpu MHz'))
      .map((l) => Math.round(parseFloat(l.split(':')[1]) || 0));
  } catch {
    return [];
  }
}

async function refreshZfsPools() {
  try {
    const { listPools } = await import('./zfs.js');
    cachedZfsPools = await listPools();
  } catch {
    cachedZfsPools = [];
  }
}

// ─── Main collector ───────────────────────────────────────────────────────────

export async function collectMetrics() {
  if (!isLinux) {
    // Fallback for non-Linux dev environments using os module only
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const cpus = os.cpus();
    return {
      timestamp: Date.now(),
      cpu: {
        cores: cpus.map((c) => ({ usage: 0, freq: Math.round(c.speed) })),
        overall: 0,
        loadAvg: os.loadavg(),
      },
      ram: { total: totalRam, used: totalRam - freeRam, free: freeRam, swapTotal: 0, swapUsed: 0 },
      network: { interfaces: {} },
      disks: {},
      zfs: { pools: [] },
      uptime: os.uptime(),
    };
  }

  const [cpuStats, cpuFreqs, netStats, diskStats, meminfo] = await Promise.all([
    parseProcStat(),
    getCpuFreqs(),
    parseProcNetDev(),
    parseProcDiskStats(),
    parseProcMeminfo(),
  ]);

  // ── CPU ──
  let cpuCores = [];
  let cpuOverall = 0;

  if (prevCpuStats) {
    const cores = cpuStats.slice(1);
    const prevCores = prevCpuStats.slice(1);
    cpuCores = cores.map((core, i) => {
      const prev = prevCores[i];
      if (!prev) return { usage: 0, freq: cpuFreqs[i] || 0 };
      const idleDelta = core.idle - prev.idle;
      const totalDelta = core.total - prev.total;
      const usage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : 0;
      return { usage: Math.max(0, Math.min(100, usage)), freq: cpuFreqs[i] || 0 };
    });

    const agg = cpuStats[0];
    const prevAgg = prevCpuStats[0];
    const idleDelta = agg.idle - prevAgg.idle;
    const totalDelta = agg.total - prevAgg.total;
    cpuOverall = totalDelta > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10)) : 0;
  } else {
    cpuCores = cpuStats.slice(1).map((_, i) => ({ usage: 0, freq: cpuFreqs[i] || 0 }));
  }
  prevCpuStats = cpuStats;

  // ── RAM ──
  const totalRam = os.totalmem();
  const freeRam = os.freemem();

  // ── Network ──
  const dtSec = INTERVAL_MS / 1000;
  const networkInterfaces = {};
  for (const [iface, stats] of Object.entries(netStats)) {
    if (iface === 'lo') continue;
    const prev = prevNetStats?.[iface];
    networkInterfaces[iface] = {
      rxBytes: stats.rxBytes,
      txBytes: stats.txBytes,
      rxRate: prev ? Math.max(0, (stats.rxBytes - prev.rxBytes) / dtSec) : 0,
      txRate: prev ? Math.max(0, (stats.txBytes - prev.txBytes) / dtSec) : 0,
    };
  }
  prevNetStats = netStats;

  // ── Disk I/O ──
  const disks = {};
  for (const [disk, stats] of Object.entries(diskStats)) {
    const prev = prevDiskStats?.[disk];
    disks[disk] = {
      readRate: prev ? Math.max(0, (stats.readSectors - prev.readSectors) * 512 / dtSec) : 0,
      writeRate: prev ? Math.max(0, (stats.writeSectors - prev.writeSectors) * 512 / dtSec) : 0,
    };
  }
  prevDiskStats = diskStats;

  // ── ZFS (throttled) ──
  if (zfsTickCount % ZFS_INTERVAL_TICKS === 0) {
    await refreshZfsPools();
  }
  zfsTickCount++;

  return {
    timestamp: Date.now(),
    cpu: { cores: cpuCores, overall: cpuOverall, loadAvg: os.loadavg() },
    ram: {
      total: totalRam,
      used: totalRam - freeRam,
      free: freeRam,
      swapTotal: meminfo.swapTotal,
      swapUsed: meminfo.swapTotal - meminfo.swapFree,
    },
    network: { interfaces: networkInterfaces },
    disks,
    zfs: { pools: cachedZfsPools },
    uptime: os.uptime(),
  };
}

export function startMetricsCollector() {
  if (intervalId) return;

  // First tick
  collectMetrics()
    .then((m) => global.broadcastSystemMetrics?.(m))
    .catch((e) => console.error('[Metrics] Initial collection error:', e.message));

  intervalId = setInterval(async () => {
    try {
      const metrics = await collectMetrics();
      global.broadcastSystemMetrics?.(metrics);
    } catch (e) {
      console.error('[Metrics] Collection error:', e.message);
    }
  }, INTERVAL_MS);
}

export function stopMetricsCollector() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
