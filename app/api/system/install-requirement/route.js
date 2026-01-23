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
      libheif: 'libheif1',
      ghostscript: 'ghostscript',
    };

    const packageInfo = packages[name.toLowerCase()];
    if (!packageInfo) {
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

    const packageName = packages[name.toLowerCase()];
    if (!packageName) {
      return NextResponse.json({ error: 'Unknown package' }, { status: 400 });
    }

    // Install the package
    try {
      logger.info('Executing install command for:', { name, packageName });

      await execAsync(`sudo apt-get update && sudo apt-get install -y ${packageName}`);

      logger.info('Successfully installed:', { name, packageName });

      return NextResponse.json({
        message: `${name} has been successfully installed`,
        success: true,
      });
    } catch (installError) {
      logger.error('Installation error:', { name, error: installError.message });

      // If installation failed but the command ran (sudo issue, permission denied, etc.)
      if (installError.message.includes('sudo')) {
        return NextResponse.json(
          {
            message: `Installation requires sudo access. Please run: sudo apt-get install -y ${packageName}`,
            error: 'Sudo access required',
          },
          { status: 400 },
        );
      }

      return NextResponse.json(
        {
          message: `Installation failed: ${installError.message}`,
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
