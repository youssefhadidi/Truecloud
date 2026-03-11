/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

// Only available on Linux systems
const isLinux = process.platform === 'linux';

// Minimum required versions for HEVC support
const MIN_VERSIONS = {
  libde265: '1.0.15',
  libheif: '1.19.0',
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
    const { session, error } = await requireAuth();
    if (error) return error;

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
      ghostscript: 'ghostscript',
      'sharp hevc': 'sharp-hevc-custom',
      'java 21': 'openjdk-21-jre-headless',
      unzip: 'unzip',
      samba: 'samba',
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
    // Ensure Node.js bin dir is on PATH (systemd services often have a minimal PATH)
    const nodeBinDir = require('path').dirname(process.execPath);
    const enhancedPath = `${nodeBinDir}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;
    const execOpts = { timeout: 120000, maxBuffer: 1024 * 1024 * 5, env: { ...process.env, PATH: enhancedPath, DEBIAN_FRONTEND: 'noninteractive' } };

    try {
      logger.info('Executing install command for:', { name, packageName });

      // Sharp HEVC requires building libde265 + libheif + libvips from source
      if (name.toLowerCase() === 'sharp hevc') {
        const projectDir = process.cwd();
        const longOpts = { ...execOpts, timeout: 600000 };
        const arch = (await execAsync('dpkg --print-architecture 2>/dev/null || echo amd64')).stdout.trim();
        const triplet = arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
        const pkgConfigPath = `/usr/local/lib/pkgconfig:/usr/local/lib/${triplet}/pkgconfig:/usr/lib/${triplet}/pkgconfig:${process.env.PKG_CONFIG_PATH || ''}`;
        const ldPath = `/usr/local/lib/${triplet}:/usr/local/lib:${process.env.LD_LIBRARY_PATH || ''}`;
        const buildEnv = { ...process.env, PATH: enhancedPath, PKG_CONFIG_PATH: pkgConfigPath, LD_LIBRARY_PATH: ldPath, DEBIAN_FRONTEND: 'noninteractive' };

        // Step 1: Install build dependencies and remove conflicting system packages
        logger.info('Step 1/7: Installing build dependencies...');
        // Remove old system libheif/libde265/libvips/libraw dev packages to prevent conflicts
        await execAsync(
          `sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 && \
            sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq libheif-dev libde265-dev libvips-dev libvips42 libraw-dev 2>&1 || true && \
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
            apt-utils build-essential pkg-config cmake meson ninja-build \
            libglib2.0-dev libexpat1-dev libjpeg-dev libpng-dev libtiff-dev libwebp-dev \
            libexif-dev liblcms2-dev liborc-0.4-dev libfftw3-dev curl xz-utils 2>&1`,
          longOpts,
        );

        // Step 2: Build libraw from source for broadest camera support
        // NOTE: libvips looks for 'libraw_r' (thread-safe) via pkg-config, not 'libraw'
        const LIBRAW_VERSION = '0.21.3';
        const rawDir = '/tmp/libraw-build';
        const rawVer = await getPkgVersion('libraw_r', buildEnv);
        if (rawVer && versionSatisfies(rawVer, LIBRAW_VERSION)) {
          logger.info(`Step 2/7: Skipped — libraw_r ${rawVer} >= ${LIBRAW_VERSION}`);
        } else {
          logger.info(`Step 2/7: Building libraw ${LIBRAW_VERSION} from source (current: ${rawVer || 'not found'})...`);
          await execAsync(
            `rm -rf ${rawDir} && mkdir -p ${rawDir} && cd ${rawDir} && \
            curl -fsSL --retry 3 https://www.libraw.org/data/LibRaw-${LIBRAW_VERSION}.tar.gz -o libraw.tar.gz 2>&1 && \
            tar xzf libraw.tar.gz 2>&1 && cd LibRaw-${LIBRAW_VERSION} && \
            ./configure --prefix=/usr/local --disable-examples --disable-static --disable-openmp 2>&1 && \
            make -j$(nproc) 2>&1 && sudo make install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          logger.info('libraw built successfully');
        }

        // Normalize libraw_r.pc to remove optional lcms2 plugins (-llcms2_fast_float,
        // -llcms2_threaded) and -fopenmp from Libs. These are not universally available
        // and cause meson's link test to fail, making libvips skip RAW support entirely.
        let pcNormalized = false;
        try {
          const { stdout: pcBefore } = await execAsync(
            `grep "^Libs:" /usr/local/lib/pkgconfig/libraw_r.pc 2>/dev/null || true`,
          );
          if (pcBefore.includes('lcms2_fast_float') || pcBefore.includes('lcms2_threaded') || pcBefore.includes('-fopenmp')) {
            await execAsync(
              `sed -i 's/ -llcms2_fast_float//g; s/ -llcms2_threaded//g; s/ -fopenmp//g' /usr/local/lib/pkgconfig/libraw_r.pc`,
            );
            pcNormalized = true;
            const { stdout: pcAfter } = await execAsync(`grep "^Libs:" /usr/local/lib/pkgconfig/libraw_r.pc`);
            logger.info(`libraw_r.pc normalized (removed optional lcms2 plugins). Libs now: ${pcAfter.trim()}`);
          } else {
            logger.info(`libraw_r.pc Libs already clean: ${pcBefore.trim()}`);
          }
        } catch (e) {
          logger.warn('Could not normalize libraw_r.pc:', e.message);
        }

        // Step 3: Build libde265 if needed (HEVC decoder)
        const de265Dir = '/tmp/libde265-build';
        const de265Ver = await getPkgVersion('libde265', buildEnv);
        if (de265Ver && versionSatisfies(de265Ver, MIN_VERSIONS.libde265)) {
          logger.info(`Step 3/7: Skipped — libde265 ${de265Ver} >= ${MIN_VERSIONS.libde265}`);
        } else {
          logger.info(`Step 3/7: Building libde265 from source (current: ${de265Ver || 'not found'}, need >= ${MIN_VERSIONS.libde265})...`);
          await execAsync(
            `rm -rf ${de265Dir} && mkdir -p ${de265Dir} && cd ${de265Dir} && \
            curl -fsSL --retry 3 https://github.com/strukturag/libde265/releases/download/v1.0.15/libde265-1.0.15.tar.gz -o libde265.tar.gz 2>&1 && \
            tar xzf libde265.tar.gz 2>&1 && cd libde265-1.0.15 && \
            mkdir build && cd build && \
            cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release .. 2>&1 && \
            make -j$(nproc) 2>&1 && sudo make install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          logger.info('libde265 built successfully');
        }

        // Step 3: Build libheif if needed
        // IMPORTANT: Build with -DWITH_LIBDE265_PLUGIN=OFF so libde265 is linked
        // directly into libheif.so. Otherwise libde265 becomes a separate plugin
        // file in /usr/local/lib/libheif/ that can't be found at runtime inside
        // Node.js, meaning only AVIF (via AOM) works but not HEIC (via HEVC).
        const heifDir = '/tmp/libheif-build';
        const heifVer = await getPkgVersion('libheif', buildEnv);
        let heifHasBuiltinDe265 = false;
        if (heifVer && versionSatisfies(heifVer, MIN_VERSIONS.libheif)) {
          // Version OK, but check if libde265 is linked IN (not a plugin)
          try {
            const { stdout: lddHeif } = await execAsync(
              `ldd $(find /usr/local/lib -name "libheif.so.1" \\( -type f -o -type l \\) 2>/dev/null | head -1) 2>/dev/null | grep -q de265 && echo "BUILTIN" || echo "PLUGIN"`,
              { env: buildEnv },
            );
            heifHasBuiltinDe265 = lddHeif.trim() === 'BUILTIN';
          } catch {}
        }

        if (heifVer && versionSatisfies(heifVer, MIN_VERSIONS.libheif) && heifHasBuiltinDe265) {
          logger.info(`Step 4/7: Skipped — libheif ${heifVer} >= ${MIN_VERSIONS.libheif} with built-in libde265`);
        } else {
          logger.info(
            `Step 4/7: Building libheif from source (current: ${heifVer || 'not found'}, de265 built-in: ${heifHasBuiltinDe265}, need >= ${MIN_VERSIONS.libheif} with built-in de265)...`,
          );
          await execAsync(
            `rm -rf ${heifDir} && mkdir -p ${heifDir} && cd ${heifDir} && \
            curl -fsSL --retry 3 https://github.com/strukturag/libheif/releases/download/v1.19.8/libheif-1.19.8.tar.gz -o libheif.tar.gz 2>&1 && \
            tar xzf libheif.tar.gz 2>&1 && cd libheif-1.19.8 && \
            mkdir build && cd build && \
            cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release \
              -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF \
              -DWITH_LIBDE265=ON -DWITH_LIBDE265_PLUGIN=OFF .. 2>&1 && \
            make -j$(nproc) 2>&1 && sudo make install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          // Verify libde265 is now linked into libheif
          try {
            const { stdout: verifyLink } = await execAsync(`ldd /usr/local/lib/libheif.so 2>/dev/null | grep de265 || echo "WARNING: de265 NOT linked"`);
            logger.info(`libheif de265 linkage: ${verifyLink.trim()}`);
          } catch {}
          const newHeifVer = await getPkgVersion('libheif', buildEnv);
          logger.info(`libheif installed: ${newHeifVer || 'unknown'}`);
        }

        // Track whether libheif or libraw was just rebuilt — if so, force libvips rebuild
        const heifWasRebuilt = !(heifVer && versionSatisfies(heifVer, MIN_VERSIONS.libheif) && heifHasBuiltinDe265);
        const rawWasRebuilt = !(rawVer && versionSatisfies(rawVer, LIBRAW_VERSION)) || pcNormalized;
        // rawVer was checked against libraw_r above

        // Step 4-5: Build libvips to match sharp's bundled version, with HEIF+RAW support
        const VIPS_VERSION = '8.17.3';
        const vipsDir = '/tmp/libvips-build';
        const vipsVer = await getPkgVersion('vips', buildEnv);
        let vipsHasHeif = false;
        let vipsHasRaw = false;
        if (vipsVer && versionSatisfies(vipsVer, MIN_VERSIONS.vips)) {
          try {
            const { stdout: heifCheck } = await execAsync(`LD_LIBRARY_PATH="${ldPath}" /usr/local/bin/vips -l 2>&1 | grep -i heifload || true`, { env: buildEnv });
            vipsHasHeif = heifCheck.trim().length > 0;
          } catch {}
          // Check if existing libvips was built with libraw_r by inspecting its ldd
          // Use the real .so file (not the symlink) for accurate ldd output
          try {
            const { stdout: rawCheck } = await execAsync(
              `libvips_so=$(find /usr/local/lib -name "libvips.so.*.*.*" -type f 2>/dev/null | head -1); \
               [ -n "$libvips_so" ] && ldd "$libvips_so" 2>/dev/null | grep -qi "libraw" && echo "YES" || echo "NO"`,
            );
            vipsHasRaw = rawCheck.trim() === 'YES';
            logger.info(`vipsHasRaw pre-check: ${rawCheck.trim()}`);
          } catch {}
        }

        if (vipsHasHeif && vipsHasRaw && !heifWasRebuilt && !rawWasRebuilt) {
          logger.info(`Steps 5-6/7: Skipped — libvips ${vipsVer} >= ${MIN_VERSIONS.vips} with HEIF+RAW support`);
        } else {
          if (heifWasRebuilt) {
            logger.info(`Step 5/7: Forcing libvips rebuild because libheif was just rebuilt...`);
          } else if (rawWasRebuilt || !vipsHasRaw) {
            logger.info(`Step 5/7: Forcing libvips rebuild to include libraw support...`);
          } else {
            logger.info(`Step 5/7: Downloading libvips source (current: ${vipsVer || 'not found'}, need >= ${MIN_VERSIONS.vips} with HEIF+RAW)...`);
          }
          await execAsync(
            `rm -rf ${vipsDir} && mkdir -p ${vipsDir} && cd ${vipsDir} && \
            curl -fsSL --retry 3 https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz | tar xJ 2>&1`,
            longOpts,
          );

          logger.info('Step 6/7: Building libvips with HEIF/HEVC+RAW support...');
          // Verify pkg-config finds libheif and libraw_r before building
          try {
            const { stdout: heifPc } = await execAsync('pkg-config --modversion libheif 2>&1 && pkg-config --libs libheif 2>&1', { env: buildEnv });
            logger.info('pkg-config libheif before vips build:', heifPc.trim().replace(/\n/g, ' | '));
          } catch (e) {
            logger.error('libheif not found by pkg-config before vips build:', e.message);
          }
          try {
            const { stdout: rawPc } = await execAsync('pkg-config --modversion libraw_r 2>&1 && pkg-config --libs libraw_r 2>&1', { env: buildEnv });
            logger.info('pkg-config libraw_r before vips build:', rawPc.trim().replace(/\n/g, ' | '));
          } catch (e) {
            logger.error('libraw_r not found by pkg-config before vips build:', e.message);
          }
          // Also remove any previously installed libvips to avoid stale cached .so
          await execAsync(`sudo rm -f /usr/local/lib/libvips*.so* /usr/local/lib/${triplet}/libvips*.so* 2>&1 && sudo ldconfig 2>&1`).catch(() => {});

          const mesonResult = await execAsync(
            `cd ${vipsDir}/vips-${VIPS_VERSION} && \
            PKG_CONFIG_PATH="${pkgConfigPath}" LD_LIBRARY_PATH="${ldPath}" \
            meson setup build --prefix=/usr/local --buildtype=release \
              -Dintrospection=disabled -Dheif=enabled -Dmodules=disabled 2>&1`,
            { ...longOpts, env: buildEnv },
          );
          logger.info('Meson setup output (last 800 chars):', mesonResult.stdout?.slice(-800));

          // Build with -j1 (sequential) to avoid a race condition in the parallel build
          // where GCC tries to write dependency (.d) files to directories that haven't
          // been created yet by ninja's parallel mkdir steps. Sequential build is slower
          // but completely reliable. Timeout extended to 30 min to accommodate this.
          // Use bash explicitly for set -o pipefail (PIPESTATUS is bash-only, not dash/sh).
          await execAsync(
            `cd ${vipsDir}/vips-${VIPS_VERSION}/build && \
            bash -c 'set -o pipefail; ninja -j1 2>&1 | tee /tmp/vips-ninja.log' && \
            sudo ninja install 2>&1 && sudo ldconfig 2>&1`,
            { ...longOpts, timeout: 1800000, maxBuffer: 1024 * 1024 * 50, env: buildEnv },
          );

          // Verify libvips has heif
          try {
            const { stdout } = await execAsync(`LD_LIBRARY_PATH="${ldPath}" /usr/local/bin/vips -l 2>&1 | grep -i heifload || echo "NO HEIF DETECTED"`, { env: buildEnv });
            logger.info(`libvips heif verification: ${stdout.trim()}`);
          } catch {}

          // Verify libvips has libraw (camera RAW support)
          try {
            const { stdout: rawLdd } = await execAsync(
              `ldd /usr/local/lib/libvips.so 2>/dev/null | grep -i "libraw" || echo "libraw_r NOT LINKED"`,
              { env: buildEnv },
            );
            logger.info(`libvips RAW verification (ldd): ${rawLdd.trim()}`);
          } catch {}
          try {
            const { stdout: rawVipsConfig } = await execAsync(
              `LD_LIBRARY_PATH="${ldPath}" /usr/local/bin/vips --vips-config 2>&1 | grep -i "libraw\\|raw " || echo "RAW not in vips config"`,
              { env: buildEnv },
            );
            logger.info(`libvips RAW verification (vips-config): ${rawVipsConfig.trim()}`);
          } catch {}
        }

        // Cleanup build dirs
        await execAsync(`rm -rf ${rawDir} ${de265Dir} ${heifDir} ${vipsDir} 2>&1`).catch(() => {});

        // Step 6: Patch sharp's bundled libvips with our HEIF-enabled version
        //
        // Key insight: sharp.node links to a fat bundled "libvips-cpp.so.X.Y.Z"
        // (16MB+ single file with ALL deps statically linked, but compiled
        // WITHOUT HEIC/HEVC — only AVIF via AOM).
        //
        // Our source-built libvips-cpp is a thin dynamic wrapper (~330KB) with
        // a different soname (e.g. libvips-cpp.so.42). Simply copying it next
        // to the fat library doesn't help — sharp.node never loads it.
        //
        // Solution: REPLACE the fat library file with our thin HEIF-enabled
        // wrapper RENAMED to the same filename. Transitive deps are resolved
        // via ldconfig cache and LD_LIBRARY_PATH.
        logger.info('Step 7/7: Patching sharp bundled libvips with HEIF-enabled version...');

        // Register custom lib dirs in the system linker cache
        await execAsync(
          `echo "/usr/local/lib/${triplet}" | sudo tee /etc/ld.so.conf.d/truecloud-vips.conf >/dev/null 2>&1; \
           echo "/usr/local/lib" | sudo tee -a /etc/ld.so.conf.d/truecloud-vips.conf >/dev/null 2>&1; \
           sudo ldconfig 2>&1`,
        ).catch((e) => logger.warn('ldconfig registration:', e.message));

        // Resolve bun path
        let bunBin = 'bun';
        try {
          const { stdout: bunPath } = await execAsync('command -v bun 2>/dev/null || which bun 2>/dev/null || echo ""', { env: buildEnv });
          if (bunPath.trim()) bunBin = bunPath.trim();
        } catch {}
        logger.info(`Using bun at: ${bunBin}`);

        // Ensure sharp is installed normally first (resets bundled dir to stock)
        await execAsync(`${bunBin} remove sharp 2>&1 || true`, { ...longOpts, cwd: projectDir });
        await execAsync(`${bunBin} add sharp 2>&1`, { ...longOpts, cwd: projectDir });

        // Find the bundled libvips directory
        const { stdout: libvipsDir } = await execAsync(
          `find node_modules -path "*/@img/sharp-libvips-linux-x64/lib" -type d 2>/dev/null | head -1 || \
           find node_modules -path "*/@img/sharp-libvips-*/lib" -type d 2>/dev/null | head -1`,
          { cwd: projectDir },
        );
        const bundledLibDir = libvipsDir.trim();

        if (bundledLibDir) {
          logger.info(`Found bundled libvips at: ${bundledLibDir}`);

          // Find where our source-built libvips was installed
          const { stdout: vipsCppSearch } = await execAsync(`find /usr/local/lib -name "libvips-cpp.so" \\( -type f -o -type l \\) 2>/dev/null | head -1`);
          const localLibDir = vipsCppSearch.trim() ? vipsCppSearch.trim().substring(0, vipsCppSearch.trim().lastIndexOf('/')) : `/usr/local/lib/${triplet}`;
          logger.info(`Source-built libraries in: ${localLibDir}`);

          // Detect what library filename sharp.node actually loads using ldd
          // (avoids matching wrong files from previous patch artifacts in ls output)
          let fatLibName = 'libvips-cpp.so.8.17.3'; // fallback
          try {
            const { stdout: sharpNodePath } = await execAsync(`find node_modules -path "*/@img/sharp-linux-x64/lib/sharp*.node" 2>/dev/null | head -1`, { cwd: projectDir });
            if (sharpNodePath.trim()) {
              const { stdout: lddName } = await execAsync(`ldd "${sharpNodePath.trim()}" 2>/dev/null | grep "libvips-cpp" | awk '{print $1}'`, { cwd: projectDir });
              if (lddName.trim()) fatLibName = lddName.trim();
            }
          } catch {}
          logger.info(`Sharp expects: ${fatLibName} (replacing with HEIF-enabled build)`);

          // Get the real path of our source-built libvips-cpp.so
          const { stdout: realCppPath } = await execAsync(`readlink -f "${localLibDir}/libvips-cpp.so" 2>/dev/null`);
          const realCppFile = realCppPath.trim();

          if (realCppFile) {
            // Clean ALL .so files from bundled dir (removes stock fat lib + old patch artifacts)
            // Preserves index.js and glib-2.0/ directory
            await execAsync(`find "${bundledLibDir}" -maxdepth 1 -name "*.so*" -delete 2>/dev/null || true`);

            // 1) Copy our HEIF-enabled wrapper, renamed to the filename sharp expects
            await execAsync(`cp -fL "${realCppFile}" "${bundledLibDir}/${fatLibName}"`);
            logger.info(`Replaced ${fatLibName} with ${realCppFile}`);

            // 3) Copy core libvips.so and its soname links (needed by our thin wrapper)
            await execAsync(`cp -fL ${localLibDir}/libvips.so* "${bundledLibDir}/" 2>/dev/null || true`);

            // 4) Copy HEIF/HEVC and RAW runtime libraries
            // NOTE: libvips links against libraw_r (thread-safe), not libraw
            await execAsync(
              `for dir in "${localLibDir}" "/usr/local/lib" "/usr/lib/${triplet}"; do \
                 cp -fL $dir/libheif.so* "${bundledLibDir}/" 2>/dev/null || true; \
                 cp -fL $dir/libde265.so* "${bundledLibDir}/" 2>/dev/null || true; \
                 cp -fL $dir/libraw_r.so* "${bundledLibDir}/" 2>/dev/null || true; \
                 cp -fL $dir/libraw.so* "${bundledLibDir}/" 2>/dev/null || true; \
               done`,
            );

            // 5) Verify the patched library resolves its dependencies
            try {
              const { stdout: lddOut } = await execAsync(
                `LD_LIBRARY_PATH="${localLibDir}:/usr/local/lib" ldd "${bundledLibDir}/${fatLibName}" 2>&1 | grep -E "vips|heif|de265|raw_r|libraw|not found" | head -10`,
              );
              logger.info(`Dependency check:\n${lddOut.trim()}`);
            } catch {}

            // List final directory contents
            try {
              const { stdout: lsList } = await execAsync(`ls -lah "${bundledLibDir}/" 2>&1`);
              logger.info('Final bundled lib dir:', lsList.trim());
            } catch {}

            logger.info('Successfully patched sharp with HEIF-enabled libvips');
          } else {
            logger.error('Could not find source-built libvips-cpp.so — build may have failed');
          }
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
          const ldLibPathVal = `/usr/local/lib/${triplet}:/usr/local/lib`;
          if (!envContent.includes('LD_LIBRARY_PATH')) {
            envContent += `LD_LIBRARY_PATH=${ldLibPathVal}\n`;
          } else {
            envContent = envContent.replace(/^LD_LIBRARY_PATH=.*/m, `LD_LIBRARY_PATH=${ldLibPathVal}`);
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
            const svcLdPath = `/usr/local/lib/${triplet}:/usr/local/lib`;
            let svcChanged = false;
            if (!svc.includes('SHARP_FORCE_GLOBAL_LIBVIPS')) {
              svc = svc.replace(/^(ExecStart=.*)$/m, `Environment="SHARP_FORCE_GLOBAL_LIBVIPS=1"\nEnvironment="LD_LIBRARY_PATH=${svcLdPath}"\n$1`);
              svcChanged = true;
            }
            // Update LD_LIBRARY_PATH if it exists but is missing the triplet dir
            if (svc.includes('LD_LIBRARY_PATH') && !svc.includes(triplet)) {
              svc = svc.replace(/Environment="LD_LIBRARY_PATH=.*"/m, `Environment="LD_LIBRARY_PATH=${svcLdPath}"`);
              svcChanged = true;
            }
            if (svcChanged) {
              writeFileSync(serviceFile, svc);
              await execAsync('sudo systemctl daemon-reload 2>&1').catch(() => {});
              logger.info('Updated systemd service with correct LD_LIBRARY_PATH');
            }
          }
        } catch (svcErr) {
          logger.warn('Could not update systemd service:', svcErr.message);
        }

        // Verify HEVC support by checking if the patched libvips-cpp can load HEIC
        // NOTE: sharp.format.heif.input.fileSuffix is hardcoded at npm publish time
        // and always shows [".avif"] regardless of runtime libvips capabilities.
        // Instead, we check: (a) ldd confirms libheif is linked, and
        // (b) vips reports heifload with .heic support.
        let hevcWorking = false;
        try {
          // Find the patched fat lib (same find logic as check-requirements)
          const { stdout: patchedLib } = await execAsync(`find node_modules -path "*/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.*.*.*" -type f 2>/dev/null | head -1`, {
            cwd: projectDir,
          });
          if (patchedLib.trim()) {
            // Use LD_LIBRARY_PATH so ldd can resolve transitive deps (libvips → libheif)
            // from both the bundled dir and /usr/local/lib
            const bundledDir = patchedLib.trim().substring(0, patchedLib.trim().lastIndexOf('/'));
            const lddLdPath = `${bundledDir}:${ldPath}`;
            const { stdout: lddCheck } = await execAsync(`LD_LIBRARY_PATH="${lddLdPath}" ldd "${patchedLib.trim()}" 2>/dev/null | grep -q heif && echo "LINKED" || echo "MISSING"`);
            const { stdout: vipsCheck } = await execAsync(
              `LD_LIBRARY_PATH="${ldPath}" /usr/local/bin/vips -l 2>&1 | grep -i "heifload)" | grep -q ".heic" && echo "HEIC_OK" || echo "NO_HEIC"`,
              { env: buildEnv },
            );
            hevcWorking = lddCheck.trim() === 'LINKED' && vipsCheck.trim() === 'HEIC_OK';
            logger.info(`Sharp HEVC verification: libheif=${lddCheck.trim()}, vips_heic=${vipsCheck.trim()}, result=${hevcWorking}`);
          }
        } catch (e) {
          logger.error('Sharp verification failed:', e.message);
        }

        return NextResponse.json({
          message: hevcWorking
            ? 'Sharp HEVC support installed and verified! Restart the application for changes to take effect.'
            : 'Installation completed but HEVC not yet detected. Restart the application and check again.',
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
      // stdout can be huge (ninja build log); only keep the tail for logging
      const stdoutRaw = installError.stdout || '';
      const stdout = stdoutRaw.length > 4000 ? '...(truncated)...\n' + stdoutRaw.slice(-4000) : stdoutRaw.trim();
      logger.error('Installation error:', { name, stderr: stderr.slice(-4000), stdout, code: installError.code });

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
