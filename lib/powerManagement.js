/** @format */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, readdir, stat } from 'fs/promises';

const execFileAsync = promisify(execFile);

const HD_IDLE_DEFAULTS_PATH = '/etc/default/hd-idle';
const GOVERNOR_UNIT_PATH = '/etc/systemd/system/truecloud-cpu-governor.service';
const POWERTOP_UNIT_PATH = '/etc/systemd/system/truecloud-powertop.service';
const GOVERNOR_UNIT_NAME = 'truecloud-cpu-governor.service';
const POWERTOP_UNIT_NAME = 'truecloud-powertop.service';
const SYSFS_CPU_DIR = '/sys/devices/system/cpu';
const SYSFS_BLOCK_DIR = '/sys/block';

const DEVICE_NAME_RE = /^[a-z][a-z0-9]*$/;
const GOVERNOR_NAME_RE = /^[a-z_]+$/;

function validateDevice(name) {
  if (typeof name !== 'string' || !DEVICE_NAME_RE.test(name) || name.length > 32) {
    throw new Error(`Invalid device name: ${name}`);
  }
}

function validateIdleSeconds(n) {
  if (!Number.isInteger(n) || n < 0 || n > 86400) {
    throw new Error(`Invalid idle seconds: ${n} (must be 0–86400)`);
  }
}

function validateGovernor(name, allowed) {
  if (typeof name !== 'string' || !GOVERNOR_NAME_RE.test(name) || name.length > 32) {
    throw new Error(`Invalid governor name: ${name}`);
  }
  if (allowed && !allowed.includes(name)) {
    throw new Error(`Governor "${name}" not available on this CPU. Available: ${allowed.join(', ')}`);
  }
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function systemctl(action, unit) {
  await execFileAsync('systemctl', [action, unit]);
}

async function systemctlDaemonReload() {
  await execFileAsync('systemctl', ['daemon-reload']);
}

async function systemctlIsActive(unit) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', unit]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

async function systemctlIsEnabled(unit) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-enabled', unit]);
    return stdout.trim() === 'enabled';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Disks                                                              */
/* ------------------------------------------------------------------ */

export async function listDisks() {
  if (!(await pathExists(SYSFS_BLOCK_DIR))) return [];
  const entries = await readdir(SYSFS_BLOCK_DIR);
  const disks = [];

  for (const name of entries) {
    if (name.startsWith('loop') || name.startsWith('ram') || name.startsWith('dm-') || name.startsWith('zd')) {
      continue;
    }
    if (!DEVICE_NAME_RE.test(name)) continue;

    const base = `${SYSFS_BLOCK_DIR}/${name}`;
    let rotational = null;
    let model = null;
    let sizeBytes = null;

    try {
      rotational = (await readFile(`${base}/queue/rotational`, 'utf8')).trim() === '1';
    } catch {}
    try {
      model = (await readFile(`${base}/device/model`, 'utf8')).trim();
    } catch {}
    try {
      const sectors = parseInt((await readFile(`${base}/size`, 'utf8')).trim(), 10);
      if (Number.isFinite(sectors)) sizeBytes = sectors * 512;
    } catch {}

    disks.push({ name, rotational, model, sizeBytes });
  }

  disks.sort((a, b) => a.name.localeCompare(b.name));
  return disks;
}

/* ------------------------------------------------------------------ */
/* hd-idle                                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse /etc/default/hd-idle into { defaultIdleSeconds, overrides }.
 * Format:
 *   START_HD_IDLE=true
 *   HD_IDLE_OPTS="-i 600 -a sda -i 1200"
 */
export async function readHdIdleConfig() {
  const defaults = { defaultIdleSeconds: 600, overrides: [] };
  if (!(await pathExists(HD_IDLE_DEFAULTS_PATH))) return defaults;

  let content;
  try {
    content = await readFile(HD_IDLE_DEFAULTS_PATH, 'utf8');
  } catch {
    return defaults;
  }

  const optsMatch = content.match(/^\s*HD_IDLE_OPTS\s*=\s*"?([^"\n]*)"?/m);
  if (!optsMatch) return defaults;
  const tokens = optsMatch[1].trim().split(/\s+/).filter(Boolean);

  let i = 0;
  let activeDevice = null;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '-i' && i + 1 < tokens.length) {
      const seconds = parseInt(tokens[i + 1], 10);
      if (Number.isFinite(seconds)) {
        if (activeDevice == null) {
          defaults.defaultIdleSeconds = seconds;
        } else {
          defaults.overrides.push({ device: activeDevice, idleSeconds: seconds });
        }
      }
      i += 2;
    } else if (tok === '-a' && i + 1 < tokens.length) {
      activeDevice = tokens[i + 1];
      i += 2;
    } else {
      i += 1;
    }
  }

  return defaults;
}

function buildHdIdleOpts({ defaultIdleSeconds, overrides }) {
  const parts = ['-i', String(defaultIdleSeconds)];
  for (const ov of overrides) {
    parts.push('-a', ov.device, '-i', String(ov.idleSeconds));
  }
  return parts.join(' ');
}

export async function writeHdIdleConfig({ enabled, defaultIdleSeconds, overrides }) {
  validateIdleSeconds(defaultIdleSeconds);
  for (const ov of overrides) {
    validateDevice(ov.device);
    validateIdleSeconds(ov.idleSeconds);
  }

  const opts = buildHdIdleOpts({ defaultIdleSeconds, overrides });
  const content =
    `# Managed by Truecloud Power Management\n` +
    `START_HD_IDLE=${enabled ? 'true' : 'false'}\n` +
    `HD_IDLE_OPTS="${opts}"\n`;
  await writeFile(HD_IDLE_DEFAULTS_PATH, content, 'utf8');

  if (enabled) {
    try {
      await systemctl('enable', 'hd-idle');
      await systemctl('restart', 'hd-idle');
    } catch (e) {
      throw new Error(`hd-idle service failed to start: ${e.message}. Is the hd-idle package installed?`);
    }
  } else {
    try { await systemctl('stop', 'hd-idle'); } catch {}
    try { await systemctl('disable', 'hd-idle'); } catch {}
  }
}

export async function getHdIdleStatus() {
  const config = await readHdIdleConfig();
  const installed = await commandExists('hd-idle');
  const active = installed ? await systemctlIsActive('hd-idle') : false;
  const enabledAtBoot = installed ? await systemctlIsEnabled('hd-idle') : false;
  return { ...config, installed, active, enabledAtBoot };
}

/* ------------------------------------------------------------------ */
/* CPU governor                                                       */
/* ------------------------------------------------------------------ */

export async function getGovernorStatus() {
  const cpu0 = `${SYSFS_CPU_DIR}/cpu0/cpufreq`;
  if (!(await pathExists(cpu0))) {
    return { supported: false, current: null, available: [], persistedAtBoot: false };
  }

  let current = null;
  let available = [];
  try {
    current = (await readFile(`${cpu0}/scaling_governor`, 'utf8')).trim();
  } catch {}
  try {
    available = (await readFile(`${cpu0}/scaling_available_governors`, 'utf8')).trim().split(/\s+/).filter(Boolean);
  } catch {}

  // Detect mismatch across cores
  let mixed = false;
  try {
    const entries = await readdir(SYSFS_CPU_DIR);
    for (const name of entries) {
      if (!/^cpu\d+$/.test(name)) continue;
      const path = `${SYSFS_CPU_DIR}/${name}/cpufreq/scaling_governor`;
      if (!(await pathExists(path))) continue;
      const v = (await readFile(path, 'utf8')).trim();
      if (v !== current) { mixed = true; break; }
    }
  } catch {}

  const persistedAtBoot = await systemctlIsEnabled(GOVERNOR_UNIT_NAME);
  return { supported: true, current: mixed ? 'mixed' : current, available, persistedAtBoot };
}

export async function applyGovernor(governor, { persist }) {
  const status = await getGovernorStatus();
  if (!status.supported) throw new Error('CPU frequency scaling is not supported on this system.');
  validateGovernor(governor, status.available);

  const entries = await readdir(SYSFS_CPU_DIR);
  for (const name of entries) {
    if (!/^cpu\d+$/.test(name)) continue;
    const path = `${SYSFS_CPU_DIR}/${name}/cpufreq/scaling_governor`;
    if (!(await pathExists(path))) continue;
    try {
      await writeFile(path, governor, 'utf8');
    } catch (e) {
      throw new Error(`Failed to set governor on ${name}: ${e.message}`);
    }
  }

  if (persist) {
    const unit =
      `[Unit]\n` +
      `Description=Truecloud CPU frequency governor\n` +
      `After=multi-user.target\n` +
      `\n` +
      `[Service]\n` +
      `Type=oneshot\n` +
      `RemainAfterExit=yes\n` +
      `ExecStart=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo ${governor} > "$g"; done'\n` +
      `\n` +
      `[Install]\n` +
      `WantedBy=multi-user.target\n`;
    await writeFile(GOVERNOR_UNIT_PATH, unit, 'utf8');
    await systemctlDaemonReload();
    await systemctl('enable', GOVERNOR_UNIT_NAME);
  } else {
    if (await pathExists(GOVERNOR_UNIT_PATH)) {
      try { await systemctl('disable', GOVERNOR_UNIT_NAME); } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* PowerTOP auto-tune                                                 */
/* ------------------------------------------------------------------ */

export async function getPowertopStatus() {
  const installed = await commandExists('powertop');
  const enabledAtBoot = await systemctlIsEnabled(POWERTOP_UNIT_NAME);
  return { installed, enabledAtBoot };
}

export async function setPowertopAutotune(enabled) {
  if (enabled) {
    const unit =
      `[Unit]\n` +
      `Description=Truecloud PowerTOP auto-tune\n` +
      `After=multi-user.target\n` +
      `\n` +
      `[Service]\n` +
      `Type=oneshot\n` +
      `RemainAfterExit=yes\n` +
      `ExecStart=/usr/sbin/powertop --auto-tune\n` +
      `\n` +
      `[Install]\n` +
      `WantedBy=multi-user.target\n`;
    await writeFile(POWERTOP_UNIT_PATH, unit, 'utf8');
    await systemctlDaemonReload();
    await systemctl('enable', POWERTOP_UNIT_NAME);
    // Apply now too
    try {
      await execFileAsync('powertop', ['--auto-tune'], { timeout: 30000 });
    } catch (e) {
      // Non-fatal — service is enabled for next boot
      console.warn('powertop --auto-tune failed (still enabled at boot):', e.message);
    }
  } else {
    if (await pathExists(POWERTOP_UNIT_PATH)) {
      try { await systemctl('disable', POWERTOP_UNIT_NAME); } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function commandExists(cmd) {
  try {
    await execFileAsync('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Mount audit                                                        */
/* ------------------------------------------------------------------ */

/**
 * Read /proc/mounts and return non-system mounts that lack noatime.
 * Useful for surfacing "this disk won't spin down because atime is updating".
 */
export async function getMountAudit() {
  if (!(await pathExists('/proc/mounts'))) return [];
  const content = await readFile('/proc/mounts', 'utf8');
  const out = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const [source, target, fstype, opts] = line.split(/\s+/);
    if (!source || !target) continue;
    // Skip pseudo filesystems
    if (!source.startsWith('/dev/')) continue;
    if (['squashfs', 'overlay', 'iso9660'].includes(fstype)) continue;
    const optList = (opts || '').split(',');
    const hasNoatime = optList.includes('noatime');
    out.push({ source, target, fstype, hasNoatime, opts: optList.join(',') });
  }
  return out;
}
