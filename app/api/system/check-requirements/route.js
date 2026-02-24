/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'node:path';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { logger } from '@/lib/logger';

/**
 * Check if a command exists in the system PATH
 */
function checkCommand(command) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${command}` : `which ${command}`;

    const check = spawn(isWindows ? 'cmd' : 'sh', isWindows ? ['/c', checkCmd] : ['-c', checkCmd]);

    let exists = false;
    check.on('close', (code) => {
      exists = code === 0;
      resolve(exists);
    });

    check.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get version of a command
 */
function getCommandVersion(command, versionFlag = '--version') {
  return new Promise((resolve) => {
    const cmd = spawn(command, [versionFlag]);
    let output = '';

    cmd.stdout.on('data', (data) => {
      output += data.toString();
    });

    cmd.stderr.on('data', (data) => {
      output += data.toString();
    });

    cmd.on('close', () => {
      const firstLine = output.split('\n')[0].trim();
      resolve(firstLine);
    });

    cmd.on('error', () => {
      resolve(null);
    });

    setTimeout(() => {
      cmd.kill();
      resolve(output.split('\n')[0]?.trim() || null);
    }, 2000);
  });
}

/**
 * Check if VAAPI hardware acceleration is available for FFmpeg
 * Tests if FFmpeg supports the VAAPI hwaccel for GPU-accelerated encoding
 */
async function checkVaapiSupport() {
  try {
    const { execSync } = await import('child_process');
    const result = execSync('ffmpeg -hwaccels 2>/dev/null | grep vaapi || true', {
      encoding: 'utf-8',
      timeout: 5000,
    })
      .trim();

    const installed = result.includes('vaapi');
    const version = installed ? 'VAAPI hardware acceleration available' : 'VAAPI not detected';
    return { installed, version };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Check if sharp can decode HEIC/HEIF via HEVC codec.
 * We check two things at runtime:
 * 1. The patched libvips-cpp in sharp's bundled dir has libheif linked
 * 2. The system vips binary reports heifload with .heic support
 *
 * NOTE: sharp.format.heif.input.fileSuffix is hardcoded at npm publish time
 * and always shows [".avif"] regardless of actual runtime capabilities.
 */
async function checkSharpHevcSupport() {
  try {
    const { execSync } = await import('child_process');
    const ldPath = '/usr/local/lib/x86_64-linux-gnu:/usr/local/lib:' + (process.env.LD_LIBRARY_PATH || '');

    // Check 1: Does the bundled libvips-cpp have libheif linked?
    let hasLibheif = false;
    try {
      const fatLib = execSync(`find node_modules -path "*/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.*.*.*" -type f 2>/dev/null | head -1`, {
        encoding: 'utf-8',
        timeout: 5000,
        cwd: process.cwd(),
      }).trim();
      if (fatLib) {
        // Set LD_LIBRARY_PATH so ldd can resolve transitive deps (libvips → libheif)
        const bundledDir = fatLib.substring(0, fatLib.lastIndexOf('/'));
        const lddLdPath = `${bundledDir}:${ldPath}`;
        const lddOut = execSync(`LD_LIBRARY_PATH="${lddLdPath}" ldd "${fatLib}" 2>/dev/null | grep heif || true`, {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        hasLibheif = lddOut.includes('libheif');
      }
    } catch {}

    // Check 2: Does vips report heifload with .heic?
    let vipsHeic = false;
    try {
      const vipsOut = execSync(`LD_LIBRARY_PATH="${ldPath}" /usr/local/bin/vips -l 2>&1 | grep "heifload)" | grep ".heic" || true`, { encoding: 'utf-8', timeout: 5000 }).trim();
      vipsHeic = vipsOut.includes('.heic');
    } catch {}

    const installed = hasLibheif && vipsHeic;
    const version = installed ? 'HEIC/HEIF/AVIF support active' : `libheif linked: ${hasLibheif}, vips .heic: ${vipsHeic}`;
    return { installed, version };
  } catch {
    return { installed: false, version: null };
  }
}

// List of required system programs (Debian only)
const REQUIRED_PROGRAMS = [
  {
    name: 'FFmpeg',
    command: 'ffmpeg',
    description: 'Video processing and thumbnail generation',
    installable: true,
    installCommand: 'sudo apt-get install -y ffmpeg',
  },
  {
    name: 'VAAPI Hardware Acceleration',
    checkType: 'vaapi',
    description: 'GPU-accelerated video encoding for MKV transcoding (Intel/AMD iGPU)',
    installable: true,
    installCommand: 'sudo apt-get install -y i965-va-driver libva2 libva-drm2 vainfo',
  },
  {
    name: 'Sharp HEVC',
    checkType: 'sharp-hevc',
    description: 'HEIC/HEIF image support (requires libde265 + libheif + libvips)',
    installable: true,
    installCommand: 'sudo apt-get install -y build-essential pkg-config libde265-dev libheif-dev libvips-dev',
  },
  {
    name: 'Ghostscript',
    command: 'gs',
    description: 'PDF processing and rendering',
    installable: true,
    installCommand: 'sudo apt-get install -y ghostscript',
  },
  {
    name: 'ZFS',
    command: 'zpool',
    description: 'ZFS pool management (zfsutils-linux)',
    installable: true,
    installCommand: 'sudo apt-get install -y zfsutils-linux',
  },
  {
    name: 'Samba',
    command: 'smbd',
    description: 'SMB/CIFS network share daemon',
    installable: true,
    installCommand: 'sudo apt-get install -y samba',
  },
];

/**
 * GET /api/system/check-requirements
 * Check which system programs are installed
 */
export async function GET(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    if (session.user.role !== 'admin') {
      logger.warn('GET /api/system/check-requirements - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requirements = await Promise.all(
      REQUIRED_PROGRAMS.map(async (prog) => {
        let installed, version;

        if (prog.checkType === 'vaapi') {
          const result = await checkVaapiSupport();
          installed = result.installed;
          version = result.version;
        } else if (prog.checkType === 'sharp-hevc') {
          const result = await checkSharpHevcSupport();
          installed = result.installed;
          version = result.version;
        } else {
          installed = await checkCommand(prog.command);
          version = installed ? await getCommandVersion(prog.command) : null;
        }

        return {
          name: prog.name,
          command: prog.command,
          description: prog.description,
          installed,
          version,
          installable: prog.installable,
          installCommand: prog.installCommand,
        };
      }),
    );

    logger.debug('GET /api/system/check-requirements - Success', {
      totalCount: requirements.length,
      installedCount: requirements.filter((r) => r.installed).length,
    });

    return NextResponse.json({ requirements });
  } catch (error) {
    logger.error('GET /api/system/check-requirements - Error', { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/install-requirement
 * Attempt to install a system requirement
 */
export async function POST(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    if (session.user.role !== 'admin') {
      logger.warn('POST /api/system/install-requirement - Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name } = await req.json();

    const program = REQUIRED_PROGRAMS.find((p) => p.name === name);
    if (!program || !program.installable) {
      return NextResponse.json({ error: `Cannot install ${name} automatically` }, { status: 400 });
    }

    // Only support Linux (Debian-based)
    const platform = process.platform;
    if (!platform.includes('linux')) {
      return NextResponse.json({ message: 'Installation is only supported on Linux systems. Please install manually.' }, { status: 400 });
    }

    const installCmd = program.installCommand;

    // Execute the install command
    const install = spawn('sh', ['-c', installCmd]);

    let output = '';
    let errorOutput = '';

    install.stdout?.on('data', (data) => {
      output += data.toString();
    });

    install.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    return new Promise((resolve) => {
      install.on('close', (code) => {
        logger.info('POST /api/system/install-requirement - Installation attempt', {
          name,
          command: installCmd,
          code,
        });

        if (code === 0) {
          resolve(
            NextResponse.json({
              message: `${name} installation started. This may take a few minutes.`,
            }),
          );
        } else {
          resolve(
            NextResponse.json(
              {
                message: `${name} installation command executed. Please check system logs for details.`,
                command: installCmd,
              },
              { status: 202 },
            ),
          );
        }
      });

      install.on('error', (err) => {
        logger.error('POST /api/system/install-requirement - Spawn error', {
          name,
          error: err.message,
        });
        resolve(NextResponse.json({ message: `Installation command: ${installCmd}` }, { status: 202 }));
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        install.kill();
        resolve(
          NextResponse.json({
            message: `${name} installation started in background.`,
          }),
        );
      }, 5000);
    });
  } catch (error) {
    logger.error('POST /api/system/install-requirement - Error', { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
