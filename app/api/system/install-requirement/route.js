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
      'sharp hevc': 'sharp-hevc-custom',
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
    const execOpts = { timeout: 120000, maxBuffer: 1024 * 1024 * 5, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } };

    try {
      logger.info('Executing install command for:', { name, packageName });

      // Sharp HEVC requires building libvips from source with HEIF/HEVC support
      if (name.toLowerCase() === 'sharp hevc') {
        const projectDir = process.cwd();
        const longOpts = { ...execOpts, timeout: 600000 };

        logger.info('Step 1/4: Installing build dependencies for libvips with HEIF/HEVC...');
        await execAsync(
          `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apt-utils build-essential pkg-config meson ninja-build \
            libde265-dev libheif-dev libglib2.0-dev libexpat1-dev libjpeg-dev libpng-dev libtiff-dev libwebp-dev \
            libexif-dev liblcms2-dev liborc-0.4-dev libfftw3-dev curl xz-utils 2>&1`,
          longOpts,
        );

        // Check system libvips version
        let vipsVersion = '0.0.0';
        try {
          const { stdout } = await execAsync('pkg-config --modversion vips 2>/dev/null || echo 0.0.0');
          vipsVersion = stdout.trim();
        } catch {}

        const [major, minor] = vipsVersion.split('.').map(Number);
        const needsBuild = major < 8 || (major === 8 && minor < 15);

        if (needsBuild) {
          logger.info(`System libvips is ${vipsVersion}, need >= 8.15.3. Building from source...`);

          const VIPS_VERSION = '8.16.0';
          const buildDir = '/tmp/libvips-build';

          logger.info('Step 2/4: Downloading libvips source...');
          await execAsync(
            `rm -rf ${buildDir} && mkdir -p ${buildDir} && cd ${buildDir} && \
            curl -sSL https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz | tar xJ 2>&1`,
            longOpts,
          );

          logger.info('Step 3/4: Building and installing libvips (this may take a few minutes)...');
          await execAsync(
            `cd ${buildDir}/vips-${VIPS_VERSION} && \
            meson setup build --prefix=/usr/local --buildtype=release -Dintrospection=disabled 2>&1 && \
            cd build && ninja 2>&1 && sudo ninja install 2>&1 && \
            sudo ldconfig 2>&1`,
            { ...longOpts, timeout: 900000 },
          );

          // Verify new libvips
          try {
            const { stdout } = await execAsync('pkg-config --modversion vips 2>&1');
            logger.info(`libvips built and installed: ${stdout.trim()}`);
          } catch {}

          // Clean up build directory
          await execAsync(`rm -rf ${buildDir} 2>&1`).catch(() => {});
        } else {
          logger.info(`System libvips ${vipsVersion} is sufficient, skipping source build`);
        }

        logger.info('Step 4/4: Rebuilding sharp with HEVC support...');
        const rebuildOpts = {
          ...longOpts,
          cwd: projectDir,
          env: {
            ...process.env,
            SHARP_FORCE_GLOBAL_LIBVIPS: '1',
            PKG_CONFIG_PATH: '/usr/local/lib/pkgconfig:/usr/local/lib/x86_64-linux-gnu/pkgconfig:' + (process.env.PKG_CONFIG_PATH || ''),
          },
        };
        await execAsync('pnpm remove sharp && pnpm add sharp 2>&1', rebuildOpts);
        logger.info('Sharp rebuilt successfully with HEVC support');

        return NextResponse.json({
          message: 'Sharp HEVC support installed successfully. Restart the application for changes to take effect.',
          success: true,
          restartRequired: true,
        });
      }

      await execAsync(
        `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apt-utils ${packageName} 2>&1`,
        execOpts,
      );

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
