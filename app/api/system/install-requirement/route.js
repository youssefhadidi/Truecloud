/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

// Only available on Linux systems
const isLinux = process.platform === 'linux';

// Minimum required versions for HEVC support
const MIN_VERSIONS = {
  libde265: '1.0.15',
  libheif: '1.17.0',
  vips: '8.15.3',
};

/**
 * Compare two semver-like version strings (e.g. "1.0.15" vs "1.0.12")
 * Returns true if `current` >= `required`
 */
function versionSatisfies(current, required) {
  const c = current.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] || 0;
    const rv = r[i] || 0;
    if (cv > rv) return true;
    if (cv < rv) return false;
  }
  return true; // equal
}

/**
 * Get the installed version of a pkg-config package, or null if not found
 */
async function getPkgVersion(pkg, env) {
  try {
    const { stdout } = await execAsync(`pkg-config --modversion ${pkg} 2>/dev/null`, { env, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

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

      // Sharp HEVC requires building libde265 + libheif + libvips from source
      if (name.toLowerCase() === 'sharp hevc') {
        const projectDir = process.cwd();
        const longOpts = { ...execOpts, timeout: 600000 };
        const arch = (await execAsync('dpkg --print-architecture 2>/dev/null || echo amd64')).stdout.trim();
        const triplet = arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
        const pkgConfigPath = `/usr/local/lib/pkgconfig:/usr/local/lib/${triplet}/pkgconfig:/usr/lib/${triplet}/pkgconfig:${process.env.PKG_CONFIG_PATH || ''}`;
        const ldPath = `/usr/local/lib:${process.env.LD_LIBRARY_PATH || ''}`;
        const buildEnv = { ...process.env, PKG_CONFIG_PATH: pkgConfigPath, LD_LIBRARY_PATH: ldPath, DEBIAN_FRONTEND: 'noninteractive' };

        // Step 1: Install build dependencies and remove conflicting system packages
        logger.info('Step 1/6: Installing build dependencies...');
        // Remove old system libheif/libde265/libvips dev packages to prevent conflicts
        await execAsync(
          `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && \
            sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq libheif-dev libde265-dev libvips-dev libvips42 2>&1 || true && \
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
            apt-utils build-essential pkg-config cmake meson ninja-build \
            libglib2.0-dev libexpat1-dev libjpeg-dev libpng-dev libtiff-dev libwebp-dev \
            libexif-dev liblcms2-dev liborc-0.4-dev libfftw3-dev curl xz-utils 2>&1`,
          longOpts,
        );

        // Step 2: Build libde265 if needed (HEVC decoder)
        const de265Dir = '/tmp/libde265-build';
        const de265Ver = await getPkgVersion('libde265', buildEnv);
        if (de265Ver && versionSatisfies(de265Ver, MIN_VERSIONS.libde265)) {
          logger.info(`Step 2/6: Skipped — libde265 ${de265Ver} >= ${MIN_VERSIONS.libde265}`);
        } else {
          logger.info(`Step 2/6: Building libde265 from source (current: ${de265Ver || 'not found'}, need >= ${MIN_VERSIONS.libde265})...`);
          await execAsync(
            `rm -rf ${de265Dir} && mkdir -p ${de265Dir} && cd ${de265Dir} && \
            curl -sSL https://github.com/strukturag/libde265/releases/download/v1.0.15/libde265-1.0.15.tar.gz -o libde265.tar.gz 2>&1 && \
            tar xzf libde265.tar.gz 2>&1 && cd libde265-1.0.15 && \
            mkdir build && cd build && \
            cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release .. 2>&1 && \
            make -j$(nproc) 2>&1 && sudo make install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          logger.info('libde265 built successfully');
        }

        // Step 3: Build libheif if needed
        const heifDir = '/tmp/libheif-build';
        const heifVer = await getPkgVersion('libheif', buildEnv);
        if (heifVer && versionSatisfies(heifVer, MIN_VERSIONS.libheif)) {
          logger.info(`Step 3/6: Skipped — libheif ${heifVer} >= ${MIN_VERSIONS.libheif}`);
        } else {
          logger.info(`Step 3/6: Building libheif from source (current: ${heifVer || 'not found'}, need >= ${MIN_VERSIONS.libheif})...`);
          await execAsync(
            `rm -rf ${heifDir} && mkdir -p ${heifDir} && cd ${heifDir} && \
            curl -sSL https://github.com/strukturag/libheif/releases/download/v1.17.6/libheif-1.17.6.tar.gz -o libheif.tar.gz 2>&1 && \
            tar xzf libheif.tar.gz 2>&1 && cd libheif-1.17.6 && \
            mkdir build && cd build && \
            cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release \
              -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF .. 2>&1 && \
            make -j$(nproc) 2>&1 && sudo make install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          // Verify
          const newHeifVer = await getPkgVersion('libheif', buildEnv);
          logger.info(`libheif installed: ${newHeifVer || 'unknown'}`);
        }

        // Step 4-5: Build libvips if needed or if it lacks heif support
        const VIPS_VERSION = '8.16.0';
        const vipsDir = '/tmp/libvips-build';
        const vipsVer = await getPkgVersion('vips', buildEnv);
        let vipsHasHeif = false;
        if (vipsVer && versionSatisfies(vipsVer, MIN_VERSIONS.vips)) {
          // Version is sufficient, check if HEIF is actually enabled
          try {
            const { stdout: heifCheck } = await execAsync('LD_LIBRARY_PATH="/usr/local/lib" vips -l 2>&1 | grep -i heifload || true', { env: buildEnv });
            vipsHasHeif = heifCheck.trim().length > 0;
          } catch {}
        }

        if (vipsHasHeif) {
          logger.info(`Steps 4-5/6: Skipped — libvips ${vipsVer} >= ${MIN_VERSIONS.vips} with HEIF support`);
        } else {
          logger.info(`Step 4/6: Downloading libvips source (current: ${vipsVer || 'not found'}, need >= ${MIN_VERSIONS.vips} with HEIF)...`);
          await execAsync(
            `rm -rf ${vipsDir} && mkdir -p ${vipsDir} && cd ${vipsDir} && \
            curl -sSL https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz | tar xJ 2>&1`,
            longOpts,
          );

          logger.info('Step 5/6: Building libvips with HEIF/HEVC support...');
          // Verify pkg-config finds our /usr/local libheif before building
          try {
            const { stdout: heifPc } = await execAsync('pkg-config --modversion libheif 2>&1 && pkg-config --libs libheif 2>&1', { env: buildEnv });
            logger.info('pkg-config libheif before vips build:', heifPc.trim().replace(/\n/g, ' | '));
          } catch (e) {
            logger.error('libheif not found by pkg-config before vips build:', e.message);
          }
          // Also remove any previously installed libvips to avoid stale cached .so
          await execAsync('sudo rm -f /usr/local/lib/libvips*.so* 2>&1 && sudo ldconfig 2>&1').catch(() => {});

          const mesonResult = await execAsync(
            `cd ${vipsDir}/vips-${VIPS_VERSION} && \
            PKG_CONFIG_PATH="${pkgConfigPath}" LD_LIBRARY_PATH="${ldPath}" \
            meson setup build --prefix=/usr/local --buildtype=release \
              -Dintrospection=disabled -Dheif=enabled 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          logger.info('Meson setup output (last 800 chars):', mesonResult.stdout?.slice(-800));

          await execAsync(
            `cd ${vipsDir}/vips-${VIPS_VERSION}/build && \
            ninja 2>&1 && sudo ninja install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, timeout: 900000, env: buildEnv },
          );

          // Verify libvips has heif
          try {
            const vipsBin = existsSync('/usr/local/bin/vips') ? '/usr/local/bin/vips' : 'vips';
            const { stdout } = await execAsync(`LD_LIBRARY_PATH="${ldPath}" ${vipsBin} -l 2>&1 | grep -i heifload || echo "NO HEIF DETECTED"`, { env: buildEnv });
            logger.info(`libvips heif verification: ${stdout.trim()}`);
          } catch {}
        }

        // Cleanup build dirs
        await execAsync(`rm -rf ${de265Dir} ${heifDir} ${vipsDir} 2>&1`).catch(() => {});

        // Step 6: Patch sharp's bundled libvips with our HEIF-enabled version
        // Sharp 0.33+ ships @img/sharp-libvips-linux-x64 with bundled .so files.
        // The prebuilt sharp.node in @img/sharp-linux-x64 loads libvips from there.
        // We replace the bundled libvips .so files with our HEIF-enabled ones
        // and add the HEIF/HEVC libraries (libheif, libde265).
        logger.info('Step 6/6: Patching sharp bundled libvips with HEIF-enabled version...');

        // Ensure sharp is installed normally first
        await execAsync('pnpm remove sharp 2>&1 || true', { ...longOpts, cwd: projectDir });
        await execAsync('pnpm add sharp 2>&1', { ...longOpts, cwd: projectDir });

        // Find the bundled libvips directory
        const { stdout: libvipsDir } = await execAsync(
          `find node_modules -path "*/@img/sharp-libvips-linux-x64/lib" -type d 2>/dev/null | head -1 || \
           find node_modules -path "*/@img/sharp-libvips-*/lib" -type d 2>/dev/null | head -1`,
          { cwd: projectDir },
        );
        const bundledLibDir = libvipsDir.trim();

        if (bundledLibDir) {
          logger.info(`Found bundled libvips at: ${bundledLibDir}`);

          // Find where our libvips was actually installed (could be /usr/local/lib or /usr/local/lib/x86_64-linux-gnu)
          const { stdout: vipsLibPath } = await execAsync(`find /usr/local/lib -name "libvips.so" -o -name "libvips.so.*" 2>/dev/null | head -1`);
          const vipsLibFile = vipsLibPath.trim();
          const localLibDir = vipsLibFile ? vipsLibFile.substring(0, vipsLibFile.lastIndexOf('/')) : '/usr/local/lib';
          logger.info(`System libvips libraries found in: ${localLibDir}`);

          // Replace bundled libvips with our HEIF-enabled build
          // Use shell glob (no quotes around the glob pattern)
          await execAsync(
            `cp -fL ${localLibDir}/libvips.so* "${bundledLibDir}/" 2>&1 && \
             cp -fL ${localLibDir}/libvips-cpp.so* "${bundledLibDir}/" 2>&1`,
            { cwd: projectDir },
          );

          // Find and copy HEIF/HEVC runtime libraries
          const { stdout: heifLibPath } = await execAsync(`find /usr/local/lib -name "libheif.so" -o -name "libheif.so.*" 2>/dev/null | head -1`);
          const heifLibDir = heifLibPath.trim() ? heifLibPath.trim().substring(0, heifLibPath.trim().lastIndexOf('/')) : localLibDir;

          const { stdout: de265LibPath } = await execAsync(`find /usr/local/lib -name "libde265.so" -o -name "libde265.so.*" 2>/dev/null | head -1`);
          const de265LibDir = de265LibPath.trim() ? de265LibPath.trim().substring(0, de265LibPath.trim().lastIndexOf('/')) : localLibDir;

          await execAsync(
            `cp -fL ${heifLibDir}/libheif.so* "${bundledLibDir}/" 2>&1; \
             cp -fL ${de265LibDir}/libde265.so* "${bundledLibDir}/" 2>&1`,
            { cwd: projectDir },
          );

          // List what we copied for verification
          try {
            const { stdout: lsList } = await execAsync(`ls -la "${bundledLibDir}/"libvips* "${bundledLibDir}/"libheif* "${bundledLibDir}/"libde265* 2>&1`);
            logger.info('Patched libraries:', lsList.trim());
          } catch {}

          logger.info('Patched bundled libvips with HEIF-enabled libraries');
        } else {
          logger.error('Could not find @img/sharp-libvips lib directory! Sharp may not work.');
        }

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
          const { stdout: verifyResult } = await execAsync(`node -e "const s=require('sharp');const h=s.format?.heif?.input;console.log(JSON.stringify(h?.fileSuffix||[]))" 2>&1`, {
            ...longOpts,
            cwd: projectDir,
            env: buildEnv,
          });
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
