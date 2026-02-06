/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

// Only available on Linux systems
const isLinux = process.platform === 'linux';

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can install requirements
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!isLinux) {
      return NextResponse.json(
        {
          message: 'Installation is only supported on Linux systems. Please install manually or use your system package manager.',
          error: 'Not supported on this platform',
        },
        { status: 400 },
      );
    }

    const { name } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Package name required' }, { status: 400 });
    }

    logger.info('Installing system requirement:', { name, user: session.user.email });

    // Map of installable packages (Debian only)
    const packages = {
      ffmpeg: 'ffmpeg',
      aria2: 'aria2',
      ghostscript: 'ghostscript',
      'sharp hevc': 'build-essential pkg-config libde265-dev libheif-dev libvips-dev',
    };

    const packageName = packages[name.toLowerCase()];
    if (!packageName) {
      return NextResponse.json({ error: 'Unknown package' }, { status: 400 });
    }

    // Try to detect the system (Debian only)
    try {
      const { stdout } = await execAsync('cat /etc/os-release');
      if (!stdout.includes('debian') && !stdout.includes('ubuntu')) {
        logger.warn('System is not Debian-based');
        return NextResponse.json(
          {
            message: 'This backend only supports Debian/Ubuntu systems',
            error: 'Unsupported operating system',
          },
          { status: 400 },
        );
      }
    } catch (e) {
      logger.warn('Could not detect OS type');
    }

    // Install the package
    const execOpts = { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } };

    try {
      logger.info('Executing install command for:', { name, packageName });

      await execAsync(
        `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apt-utils ${packageName} 2>&1`,
        execOpts,
      );

      // Sharp HEVC requires rebuilding sharp from source after installing system libs
      if (name.toLowerCase() === 'sharp hevc') {
        logger.info('Rebuilding sharp from source with HEVC support...');
        const projectDir = process.cwd();
        const rebuildOpts = { ...execOpts, cwd: projectDir, timeout: 300000, env: { ...process.env, SHARP_FORCE_GLOBAL_LIBVIPS: '1' } };
        // Remove and reinstall sharp so pnpm rebuilds it against the system libvips
        await execAsync('pnpm remove sharp && pnpm add sharp 2>&1', rebuildOpts);
        logger.info('Sharp rebuilt successfully with HEVC support');

        return NextResponse.json({
          message: 'Sharp HEVC support installed. Restart the application for changes to take effect.',
          success: true,
          restartRequired: true,
        });
      }

      logger.info('Successfully installed:', { name, packageName });

      return NextResponse.json({
        message: `${name} has been successfully installed`,
        success: true,
      });
    } catch (installError) {
      const stderr = installError.stderr?.trim() || '';
      const stdout = installError.stdout?.trim() || '';
      logger.error('Installation error:', { name, stderr, stdout, code: installError.code });

      if (stderr.includes('sudo') || installError.message.includes('sudo')) {
        return NextResponse.json(
          {
            message: `Sudo access required. Run manually: sudo apt-get install -y ${packageName}`,
            error: 'Sudo access required',
          },
          { status: 400 },
        );
      }

      // Return the actual stderr so the admin can see what failed
      return NextResponse.json(
        {
          message: `Installation failed: ${stderr || stdout || installError.message}`,
          error: 'Installation error',
        },
        { status: 400 },
      );
    }
  } catch (error) {
    logger.error('Install requirement error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
