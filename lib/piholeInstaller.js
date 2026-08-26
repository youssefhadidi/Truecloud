/** @format */

/**
 * Guided Pi-hole installation.
 *
 * Pi-hole v6's `--unattended` flag is ignored on a system that has no
 * /etc/pihole/pihole.toml or /etc/pihole/setupVars.conf: the installer decides
 * it is a fresh install, tries to open whiptail dialogs, and dies. Upstream
 * closed that as "not planned" (pi-hole/pi-hole#6380), so the supported route
 * for automation is to pre-create a config file first — which is exactly what
 * seedConfig() does.
 *
 * Two things this deliberately does NOT do:
 *   - It never edits systemd-resolved. The official installer already ships
 *     disable_resolved_stublistener(), which drops
 *     /etc/systemd/resolved.conf.d/90-pi-hole-disable-stub-listener.conf in
 *     place. Preflight only reports the conflict so it can be confirmed; the
 *     installer performs the change.
 *   - It never pipes the installer to bash. The script is downloaded to disk
 *     first so it exists on the filesystem for inspection and auditing.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isServiceActive } from '@/lib/systemctl';
import { stripAnsi } from '@/lib/pihole';

const execFileAsync = promisify(execFile);

const PIHOLE_CONFIG_DIR = '/etc/pihole';
const PIHOLE_TOML = join(PIHOLE_CONFIG_DIR, 'pihole.toml');
const SETUP_VARS = join(PIHOLE_CONFIG_DIR, 'setupVars.conf');
const STUB_LISTENER_DROPIN = '/etc/systemd/resolved.conf.d/90-pi-hole-disable-stub-listener.conf';
const INSTALLER_URL = 'https://install.pi-hole.net';
const INSTALL_TIMEOUT_MS = 20 * 60_000;

export class InstallerError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message);
    this.name = 'InstallerError';
    this.status = status;
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

async function commandExists(cmd) {
  try {
    await execFileAsync('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Preflight                                                          */
/* ------------------------------------------------------------------ */

/** Who is listening on port 53, if anyone. */
async function inspectPort(port) {
  try {
    const { stdout } = await execFileAsync('ss', ['-H', '-lntup']);
    const holders = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // Local address is the 5th column for `ss -lntup`, e.g. 127.0.0.53%lo:53
      const columns = line.trim().split(/\s+/);
      const local = columns[4] || '';
      if (!local.endsWith(`:${port}`)) continue;
      const process = line.match(/users:\(\("([^"]+)"/);
      holders.push({ address: local, process: process ? process[1] : null });
    }
    return { checked: true, holders };
  } catch {
    // ss missing or unreadable — report unknown rather than a false all-clear.
    return { checked: false, holders: [] };
  }
}

/** Primary outbound interface and its address, used to seed the config. */
async function primaryInterface() {
  try {
    const { stdout } = await execFileAsync('ip', ['-o', '-4', 'route', 'get', '1.1.1.1']);
    return {
      name: stdout.match(/\bdev\s+(\S+)/)?.[1] ?? null,
      address: stdout.match(/\bsrc\s+(\S+)/)?.[1] ?? null,
    };
  } catch {
    return { name: null, address: null };
  }
}

/**
 * Everything the confirmation screen needs. Blockers stop the install;
 * warnings need acknowledgement; actions are the changes the official
 * installer will make to this host.
 *
 * @returns {Promise<object>}
 */
export async function preflight() {
  const [alreadyInstalled, hasCurl, hasBash, port53, port80, iface, resolvedActive, stubDisabled, configExists] =
    await Promise.all([
      commandExists('pihole'),
      commandExists('curl'),
      commandExists('bash'),
      inspectPort(53),
      inspectPort(80),
      primaryInterface(),
      isServiceActive('systemd-resolved'),
      pathExists(STUB_LISTENER_DROPIN),
      Promise.all([pathExists(PIHOLE_TOML), pathExists(SETUP_VARS)]).then(([a, b]) => a || b),
    ]);

  const blockers = [];
  const warnings = [];
  const actions = [];

  if (alreadyInstalled) blockers.push({ key: 'alreadyInstalled' });
  if (!hasBash) blockers.push({ key: 'noBash' });
  if (!hasCurl) warnings.push({ key: 'noCurl' });

  // Anything on :53 that is not systemd-resolved is a genuine blocker — we
  // know how the installer deals with resolved, but not with dnsmasq or bind.
  const resolvedOn53 = port53.holders.some((h) => /systemd-resolve/.test(h.process ?? ''));
  const foreignOn53 = port53.holders.filter((h) => !/systemd-resolve/.test(h.process ?? ''));

  if (!port53.checked) {
    warnings.push({ key: 'port53Unknown' });
  } else if (foreignOn53.length > 0) {
    blockers.push({
      key: 'port53Occupied',
      detail: foreignOn53.map((h) => `${h.process ?? '?'} (${h.address})`).join(', '),
    });
  }

  if (resolvedActive && resolvedOn53 && !stubDisabled) {
    actions.push({ key: 'disableStubListener', detail: STUB_LISTENER_DROPIN });
  }

  if (port80.checked && port80.holders.length > 0) {
    warnings.push({
      key: 'port80Busy',
      detail: port80.holders.map((h) => `${h.process ?? '?'} (${h.address})`).join(', '),
    });
  }

  if (!iface.name) warnings.push({ key: 'noInterface' });
  else warnings.push({ key: 'staticIp', detail: `${iface.name} — ${iface.address ?? '?'}` });

  if (configExists) warnings.push({ key: 'configExists' });

  // The seeded config is what makes --unattended work at all; say so plainly.
  actions.push({ key: 'seedConfig', detail: PIHOLE_TOML });
  actions.push({ key: 'installPackages' });
  actions.push({ key: 'bindWebserver' });

  return {
    canInstall: blockers.length === 0,
    alreadyInstalled,
    blockers,
    warnings,
    actions,
    facts: {
      interface: iface.name,
      address: iface.address,
      port53: port53.holders,
      port80: port80.holders,
      resolvedActive,
      stubDisabled,
      configExists,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Config seeding                                                     */
/* ------------------------------------------------------------------ */

const TOML_STRING_RE = /^[A-Za-z0-9._:#[\]-]{1,253}$/;
const IFACE_RE = /^[A-Za-z0-9._-]{1,32}$/;

function tomlList(values) {
  return `[ ${values.map((v) => `"${v}"`).join(', ')} ]`;
}

/**
 * Write the minimal config that flips the installer onto its non-interactive
 * path. Deliberately small: FTL normalizes the file against its own defaults
 * on first start, so anything omitted here is filled in correctly, whereas a
 * hand-written full config would rot against every FTL release.
 *
 * @param {{ interfaceName?: string, upstreams?: string[], webPort?: string }} options
 */
export async function seedConfig({ interfaceName, upstreams = ['1.1.1.1', '1.0.0.1'], webPort = '8080' } = {}) {
  for (const upstream of upstreams) {
    if (!TOML_STRING_RE.test(upstream)) {
      throw new InstallerError(`Invalid upstream DNS server: ${upstream}`, { status: 400 });
    }
  }
  if (interfaceName && !IFACE_RE.test(interfaceName)) {
    throw new InstallerError(`Invalid interface name: ${interfaceName}`, { status: 400 });
  }
  if (!/^\d{1,5}$/.test(String(webPort))) {
    throw new InstallerError(`Invalid web port: ${webPort}`, { status: 400 });
  }

  // Loopback-only from the very first start, so the stock GUI is never
  // reachable from the network even briefly.
  const port = `127.0.0.1:${webPort},[::1]:${webPort}`;

  const toml =
    `# Seeded by Truecloud before running the Pi-hole installer.\n` +
    `# Pi-hole rewrites this file with its full defaults on first start.\n` +
    `[dns]\n` +
    `  upstreams = ${tomlList(upstreams)}\n` +
    `  listeningMode = "LOCAL"\n` +
    (interfaceName ? `  interface = "${interfaceName}"\n` : '') +
    `\n` +
    `[webserver]\n` +
    `  port = "${port}"\n`;

  await mkdir(PIHOLE_CONFIG_DIR, { recursive: true });
  await writeFile(PIHOLE_TOML, toml, 'utf8');
  return { path: PIHOLE_TOML, port };
}

/* ------------------------------------------------------------------ */
/* Install                                                            */
/* ------------------------------------------------------------------ */

/** Download the installer to disk rather than piping it into a shell. */
async function downloadInstaller(onLine) {
  const dir = join(tmpdir(), 'truecloud-pihole-install');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const scriptPath = join(dir, 'basic-install.sh');

  onLine?.(`Downloading installer from ${INSTALLER_URL}`);

  let res;
  try {
    res = await fetch(INSTALLER_URL, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new InstallerError(`Could not download the Pi-hole installer: ${e.message}`);
  }
  if (!res.ok) {
    throw new InstallerError(`Could not download the Pi-hole installer: HTTP ${res.status}`);
  }

  const script = await res.text();
  if (!script.includes('#!/usr/bin/env bash') && !script.startsWith('#!')) {
    throw new InstallerError('Downloaded installer does not look like a shell script — refusing to run it.');
  }

  await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o700 });
  onLine?.(`Saved installer to ${scriptPath} (${script.length} bytes)`);
  return scriptPath;
}

/**
 * Run the official installer, streaming its output line by line.
 * @param {(line: string, level?: string) => void} onLine
 * @param {(child: import('child_process').ChildProcess) => void} [onChild] receives the process so a job can cancel it
 */
export async function runInstaller(onLine, onChild) {
  const scriptPath = await downloadInstaller(onLine);

  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, '--unattended'], {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    onChild?.(child);

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new InstallerError('The Pi-hole installer timed out after 20 minutes.'));
    }, INSTALL_TIMEOUT_MS);

    const pump = (stream, level) => {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buffer += chunk;
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const clean = stripAnsi(line);
          if (clean) onLine?.(clean, level);
        }
      });
      stream.on('end', () => {
        const clean = stripAnsi(buffer);
        if (clean) onLine?.(clean, level);
      });
    };

    pump(child.stdout, 'info');
    pump(child.stderr, 'warn');

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new InstallerError(`Failed to launch the installer: ${e.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new InstallerError(`The Pi-hole installer exited with code ${code}.`));
    });
  });
}

/* ------------------------------------------------------------------ */
/* Post-install                                                       */
/* ------------------------------------------------------------------ */

/**
 * Set a fresh API password so Truecloud can connect without the admin having
 * to copy one by hand. The subcommand was renamed between v5 and v6, so try
 * the modern form first and fall back.
 *
 * @returns {Promise<string>} the password that was set
 */
export async function setApiPassword() {
  // URL-safe, no shell metacharacters, and passed as argv — never through a shell.
  const password = randomBytes(24).toString('base64url');

  const attempts = [
    ['setpassword', password],
    ['-a', '-p', password],
  ];

  let lastError = null;
  for (const args of attempts) {
    try {
      await execFileAsync('pihole', args, { timeout: 30_000 });
      return password;
    } catch (e) {
      lastError = e;
    }
  }

  throw new InstallerError(
    `Pi-hole was installed but setting an API password failed: ${lastError?.message ?? 'unknown error'}. ` +
      'Set one on the server with "pihole setpassword" and enter it in Settings.',
  );
}

export async function readSeededConfig() {
  try {
    return await readFile(PIHOLE_TOML, 'utf8');
  } catch {
    return null;
  }
}
