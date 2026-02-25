/** @format */

import { spawn } from 'child_process';
import fsPromises from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import { resolve } from 'path';
import { pipeline } from 'stream/promises';

const SERVERS_BASE_DIR = '/opt/minecraft-servers';
const CONSOLE_BUFFER_SIZE = 200; // lines kept per server in memory

// In-memory process registry: serverId → ChildProcess
const processes = new Map();

// In-memory console ring buffer: serverId → string[]
const consoleBuffers = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function appendConsole(serverId, lines) {
  if (!consoleBuffers.has(serverId)) consoleBuffers.set(serverId, []);
  const buf = consoleBuffers.get(serverId);
  buf.push(...lines);
  if (buf.length > CONSOLE_BUFFER_SIZE) buf.splice(0, buf.length - CONSOLE_BUFFER_SIZE);
}

export function getConsoleBuffer(serverId) {
  return consoleBuffers.get(serverId) ?? [];
}

export function isRunning(serverId) {
  return processes.has(serverId);
}

// ─── PaperMC Download ────────────────────────────────────────────────────────

/**
 * Fetches the latest PaperMC build number for a given Minecraft version.
 * Defaults to latest stable Minecraft version if version is "latest".
 */
async function resolvePaperBuild(version) {
  const versionsRes = await fetch('https://api.papermc.io/v2/projects/paper');
  if (!versionsRes.ok) throw new Error('Failed to fetch PaperMC versions');
  const { versions } = await versionsRes.json();

  const mcVersion = version === 'latest' ? versions[versions.length - 1] : version;

  const buildsRes = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${mcVersion}`);
  if (!buildsRes.ok) throw new Error(`Failed to fetch builds for ${mcVersion}`);
  const { builds } = await buildsRes.json();
  const latestBuild = builds[builds.length - 1];

  return { mcVersion, build: latestBuild };
}

/**
 * Downloads the PaperMC JAR for a given Minecraft version to destDir.
 * Returns the absolute path of the downloaded JAR.
 */
export async function downloadPaperJar(version, destDir) {
  const { mcVersion, build } = await resolvePaperBuild(version);
  const jarName = `paper-${mcVersion}-${build}.jar`;
  const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds/${build}/downloads/${jarName}`;
  const destPath = resolve(destDir, 'server.jar');

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download PaperMC JAR: ${res.status}`);

  const writer = createWriteStream(destPath);
  await pipeline(res.body, writer);

  return { destPath, mcVersion, build };
}

// ─── server.properties ───────────────────────────────────────────────────────

/**
 * Parses server.properties into a plain key→value object.
 */
export async function readServerProperties(serverDir) {
  const propsPath = resolve(serverDir, 'server.properties');
  try {
    const raw = await fsPromises.readFile(propsPath, 'utf8');
    const props = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      props[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return props;
  } catch {
    return {};
  }
}

/**
 * Writes (merges) key→value props into server.properties.
 */
export async function writeServerProperties(serverDir, props) {
  const propsPath = resolve(serverDir, 'server.properties');
  let existing = {};

  try {
    existing = await readServerProperties(serverDir);
  } catch {
    // file may not exist yet
  }

  const merged = { ...existing, ...props };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  await fsPromises.writeFile(propsPath, lines.join('\n') + '\n', 'utf8');
}

// ─── EULA ────────────────────────────────────────────────────────────────────

export async function acceptEula(serverDir) {
  const eulaPath = resolve(serverDir, 'eula.txt');
  await fsPromises.writeFile(eulaPath, '# Auto-accepted by Truecloud\neula=true\n', 'utf8');
}

// ─── World Import ─────────────────────────────────────────────────────────────

/**
 * Imports a world from a ZIP buffer.
 * Deletes existing world directories, then extracts the ZIP into serverDir.
 * Expects ZIP to contain a top-level folder named "world" (or the zip itself
 * is the world folder content).
 */
export async function importWorldZip(serverDir, zipBuffer) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Write zip to temp file
  const tmpZip = resolve(serverDir, '_world_import.zip');
  await fsPromises.writeFile(tmpZip, zipBuffer);

  // Remove existing world dirs
  for (const worldDir of ['world', 'world_nether', 'world_the_end']) {
    const p = resolve(serverDir, worldDir);
    await fsPromises.rm(p, { recursive: true, force: true });
  }

  // Extract zip into server dir
  await execFileAsync('unzip', ['-o', tmpZip, '-d', serverDir]);

  // Clean up temp zip
  await fsPromises.unlink(tmpZip).catch(() => {});
}

// ─── Process Management ──────────────────────────────────────────────────────

/**
 * Spawns a PaperMC server as a child process.
 * Wires stdout/stderr to the global WebSocket broadcaster and in-memory buffer.
 * Updates DB status via the provided prisma instance.
 */
export async function spawnServer(server, prisma) {
  if (processes.has(server.id)) {
    throw new Error(`Server ${server.name} is already running`);
  }

  const javaArgs = [
    `-Xms${server.minRam}M`,
    `-Xmx${server.maxRam}M`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-jar',
    'server.jar',
    '--nogui',
  ];

  const proc = spawn('java', javaArgs, {
    cwd: server.directory,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  processes.set(server.id, proc);
  consoleBuffers.set(server.id, []);

  // Update DB to starting
  await prisma.minecraftServer.update({
    where: { id: server.id },
    data: { status: 'starting' },
  });

  if (global.broadcastMinecraftStatus) {
    global.broadcastMinecraftStatus(server.id, 'starting');
  }

  const handleOutput = (data) => {
    const text = data.toString();
    const lines = text.split('\n').filter((l) => l.trim());
    appendConsole(server.id, lines);
    if (global.broadcastMinecraftConsole) {
      global.broadcastMinecraftConsole(server.id, lines);
    }
    // Detect "Done" line to transition to running
    if (lines.some((l) => l.includes('Done (') && l.includes('For help, type'))) {
      prisma.minecraftServer
        .update({ where: { id: server.id }, data: { status: 'running' } })
        .catch(() => {});
      if (global.broadcastMinecraftStatus) {
        global.broadcastMinecraftStatus(server.id, 'running');
      }
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('exit', async (code) => {
    processes.delete(server.id);
    const status = code === 0 ? 'stopped' : 'stopped'; // always stopped on exit
    try {
      await prisma.minecraftServer.update({
        where: { id: server.id },
        data: { status },
      });
    } catch {
      // server may have been deleted
    }
    if (global.broadcastMinecraftStatus) {
      global.broadcastMinecraftStatus(server.id, status);
    }
    appendConsole(server.id, [`[Truecloud] Server process exited with code ${code}`]);
    if (global.broadcastMinecraftConsole) {
      global.broadcastMinecraftConsole(server.id, [
        `[Truecloud] Server process exited with code ${code}`,
      ]);
    }
  });

  proc.on('error', (err) => {
    processes.delete(server.id);
    prisma.minecraftServer
      .update({ where: { id: server.id }, data: { status: 'stopped' } })
      .catch(() => {});
    if (global.broadcastMinecraftStatus) {
      global.broadcastMinecraftStatus(server.id, 'stopped');
    }
    appendConsole(server.id, [`[Truecloud] Failed to start server: ${err.message}`]);
    if (global.broadcastMinecraftConsole) {
      global.broadcastMinecraftConsole(server.id, [
        `[Truecloud] Failed to start server: ${err.message}`,
      ]);
    }
  });

  return proc;
}

/**
 * Stops a running server by sending the "stop" command to stdin.
 */
export async function stopServer(serverId, prisma) {
  const proc = processes.get(serverId);
  if (!proc) throw new Error('Server is not running');

  await prisma.minecraftServer.update({
    where: { id: serverId },
    data: { status: 'stopping' },
  });

  if (global.broadcastMinecraftStatus) {
    global.broadcastMinecraftStatus(serverId, 'stopping');
  }

  proc.stdin.write('stop\n');
}

/**
 * Sends a command string to the server's stdin.
 */
export function sendCommand(serverId, command) {
  const proc = processes.get(serverId);
  if (!proc) throw new Error('Server is not running');
  proc.stdin.write(command + '\n');
}

// ─── Directory Setup ─────────────────────────────────────────────────────────

export function getServerDirectory(name) {
  return resolve(SERVERS_BASE_DIR, name);
}

export async function createServerDirectory(name) {
  const dir = getServerDirectory(name);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

export async function deleteServerDirectory(directory) {
  await fsPromises.rm(directory, { recursive: true, force: true });
}
