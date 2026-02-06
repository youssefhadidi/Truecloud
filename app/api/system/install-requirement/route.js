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
        const arch = (await execAsync('dpkg --print-architecture 2>/dev/null || echo amd64')).stdout.trim();
        const pkgConfigPath = `/usr/local/lib/pkgconfig:/usr/local/lib/${arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/pkgconfig:/usr/lib/${arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/pkgconfig:${process.env.PKG_CONFIG_PATH || ''}`;
        const ldPath = `/usr/local/lib:${process.env.LD_LIBRARY_PATH || ''}`;
        const buildEnv = { ...process.env, PKG_CONFIG_PATH: pkgConfigPath, LD_LIBRARY_PATH: ldPath, DEBIAN_FRONTEND: 'noninteractive' };

        logger.info('Step 1/4: Installing build dependencies for libvips with HEIF/HEVC...');
        await execAsync(
          `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apt-utils build-essential pkg-config meson ninja-build \
            libde265-dev libheif-dev libglib2.0-dev libexpat1-dev libjpeg-dev libpng-dev libtiff-dev libwebp-dev \
            libexif-dev liblcms2-dev liborc-0.4-dev libfftw3-dev curl xz-utils 2>&1`,
          longOpts,
        );

        // Check if libvips already exists with heif support
        let needsVipsBuild = true;
        try {
          const { stdout: vipsVer } = await execAsync('pkg-config --modversion vips 2>/dev/null || echo 0.0.0', { env: buildEnv });
          const [major, minor] = vipsVer.trim().split('.').map(Number);
          if (major >= 8 && minor >= 15) {
            // Version is good, but check if heif is actually enabled
            const { stdout: heifCheck } = await execAsync('vips -l 2>&1 | grep -i heifload || true', { env: buildEnv });
            if (heifCheck.trim().length > 0) {
              logger.info(`System libvips ${vipsVer.trim()} already has HEIF support`);
              needsVipsBuild = false;
            } else {
              logger.info(`System libvips ${vipsVer.trim()} lacks HEIF support, rebuilding...`);
            }
          }
        } catch {}

        if (needsVipsBuild) {
          // Verify libheif is detectable by pkg-config
          try {
            const { stdout: heifVer } = await execAsync('pkg-config --modversion libheif 2>&1', { env: buildEnv });
            logger.info(`Found libheif version: ${heifVer.trim()}`);
          } catch {
            logger.error('libheif not found by pkg-config! HEIF support will fail.');
          }

          const VIPS_VERSION = '8.16.0';
          const buildDir = '/tmp/libvips-build';

          logger.info('Step 2/4: Downloading libvips source...');
          await execAsync(
            `rm -rf ${buildDir} && mkdir -p ${buildDir} && cd ${buildDir} && \
            curl -sSL https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz | tar xJ 2>&1`,
            longOpts,
          );

          logger.info('Step 3/4: Building libvips with HEIF support (this may take a few minutes)...');
          // Use -Dheif=enabled to force heif — meson will error if libheif is not found
          await execAsync(
            `cd ${buildDir}/vips-${VIPS_VERSION} && \
            PKG_CONFIG_PATH="${pkgConfigPath}" meson setup build --prefix=/usr/local --buildtype=release \
              -Dintrospection=disabled -Dheif=enabled 2>&1 && \
            cd build && ninja 2>&1 && sudo ninja install 2>&1 && \
            sudo ldconfig 2>&1`,
            { ...longOpts, timeout: 900000, env: buildEnv },
          );

          // Verify libvips has heif support
          try {
            const { stdout } = await execAsync('LD_LIBRARY_PATH="/usr/local/lib" /usr/local/bin/vips -l 2>&1 | grep -i heifload || echo "NO HEIF"');
            logger.info(`libvips heif verification: ${stdout.trim()}`);
            if (stdout.includes('NO HEIF')) {
              logger.error('libvips was built but HEIF support is still missing!');
            }
          } catch {}

          await execAsync(`rm -rf ${buildDir} 2>&1`).catch(() => {});
        } else {
          logger.info('Steps 2-3/4: Skipped (libvips already has HEIF support)');
        }

        logger.info('Step 4/4: Rebuilding sharp with system libvips...');
        const rebuildOpts = {
          ...longOpts,
          cwd: projectDir,
          env: {
            ...buildEnv,
            SHARP_FORCE_GLOBAL_LIBVIPS: '1',
            npm_config_sharp_force_global_libvips: '1',
          },
        };
        // Clear any cached prebuilt binaries and @img platform packages
        await execAsync('rm -rf node_modules/.pnpm/sharp@*/node_modules/sharp/build 2>&1; rm -rf node_modules/.pnpm/@img* 2>&1; rm -rf node_modules/@img 2>&1', {
          cwd: projectDir,
        }).catch(() => {});
        await execAsync('pnpm remove sharp 2>&1 && pnpm add sharp 2>&1', rebuildOpts);

        // Write env vars to .env.local so they persist across restarts
        const envFile = `${projectDir}/.env.local`;
        try {
          const { readFileSync, writeFileSync } = await import('fs');
          let envContent = '';
          try {
            envContent = readFileSync(envFile, 'utf-8');
          } catch {}
          if (!envContent.includes('SHARP_FORCE_GLOBAL_LIBVIPS')) {
            envContent += '\nSHARP_FORCE_GLOBAL_LIBVIPS=1\n';
          }
          if (!envContent.includes('LD_LIBRARY_PATH')) {
            envContent += 'LD_LIBRARY_PATH=/usr/local/lib\n';
          }
          writeFileSync(envFile, envContent);
          logger.info('Added SHARP_FORCE_GLOBAL_LIBVIPS and LD_LIBRARY_PATH to .env.local');
        } catch (envErr) {
          logger.warn('Could not write .env.local:', envErr.message);
        }

        // Update systemd service if it exists
        try {
          const serviceFile = '/etc/systemd/system/truecloud.service';
          const { readFileSync, writeFileSync, existsSync } = await import('fs');
          if (existsSync(serviceFile)) {
            let svc = readFileSync(serviceFile, 'utf-8');
            if (!svc.includes('SHARP_FORCE_GLOBAL_LIBVIPS')) {
              svc = svc.replace(/^(ExecStart=.*)$/m, 'Environment="SHARP_FORCE_GLOBAL_LIBVIPS=1"\nEnvironment="LD_LIBRARY_PATH=/usr/local/lib"\n$1');
              writeFileSync(serviceFile, svc);
              await execAsync('sudo systemctl daemon-reload 2>&1').catch(() => {});
              logger.info('Updated systemd service with SHARP_FORCE_GLOBAL_LIBVIPS');
            }
          }
        } catch (svcErr) {
          logger.warn('Could not update systemd service:', svcErr.message);
        }

        // Verify sharp has HEVC support
        let hevcWorking = false;
        try {
          const { stdout: verifyResult } = await execAsync(
            `LD_LIBRARY_PATH="/usr/local/lib" node -e "const s=require('sharp');const h=s.format?.heif?.input;console.log(JSON.stringify(h?.fileSuffix||[]))" 2>&1`,
            { ...longOpts, cwd: projectDir, env: buildEnv },
          );
          hevcWorking = verifyResult.includes('.heic');
          logger.info('Sharp HEIF verification:', verifyResult.trim());
        } catch (e) {
          logger.error('Sharp verification failed:', e.message);
        }

        return NextResponse.json({
          message: hevcWorking
            ? 'Sharp HEVC support installed and verified! Restart the application for changes to take effect.'
            : 'Installation completed but HEVC not yet detected. Restart the application and check again. If still not working, the system libheif may be too old.',
          success: true,
          restartRequired: true,
          hevcVerified: hevcWorking,
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
