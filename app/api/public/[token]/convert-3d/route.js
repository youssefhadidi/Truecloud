/** @format */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';

const execPromise = promisify(exec);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const CACHE_DIR = process.env.CACHE_DIR || './.cache';
const RESOLVED_CACHE_DIR = resolve(process.cwd(), CACHE_DIR);

// Ensure cache directory exists
try {
  if (!fs.existsSync(RESOLVED_CACHE_DIR)) {
    fs.mkdirSync(RESOLVED_CACHE_DIR, { recursive: true, mode: 0o755 });
  }
} catch (err) {
  console.warn('Failed to create cache directory:', err.message);
}

const NO_CONVERSION_NEEDED = ['glb', 'gltf'];

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const password = req.headers.get('x-share-password');

    // Verify share
    const verification = await verifyShare(token, password);

    if (!verification.valid) {
      if (verification.requiresPassword) {
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }
      return NextResponse.json({ error: verification.error }, { status: 404 });
    }

    const share = verification.share;

    const { searchParams } = new URL(req.url);
    const binRequest = searchParams.get('bin') === 'true';
    const subPath = searchParams.get('path') || '';
    const fileName = searchParams.get('file') || share.fileName;

    // Build the path
    let pathCheck;
    if (share.isDirectory && subPath) {
      pathCheck = validateSharePath(share, subPath);
    } else if (share.isDirectory && fileName !== share.fileName) {
      pathCheck = validateSharePath(share, fileName);
    } else {
      pathCheck = validateSharePath(share, '');
    }

    if (!pathCheck.allowed) {
      return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    }

    const fullPath = join(UPLOAD_DIR, pathCheck.fullPath);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(fullPath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Verify file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileExt = extname(fileName).toLowerCase().slice(1);

    // If it's already GLTF/GLB, return it directly
    if (NO_CONVERSION_NEEDED.includes(fileExt)) {
      const buffer = fs.readFileSync(fullPath);
      return new Response(buffer, {
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': buffer.length,
        },
      });
    }

    // Generate cache filename using hash
    const fileHash = createHash('md5').update(`${token}_${fileName}`).digest('hex');
    const cacheGlbPath = join(RESOLVED_CACHE_DIR, `${fileHash}.glb`);
    const cacheGltfPath = join(RESOLVED_CACHE_DIR, `${fileHash}.gltf`);
    const cacheBinPath = join(RESOLVED_CACHE_DIR, `${fileHash}.bin`);

    // If already converted as GLB, return it
    if (fs.existsSync(cacheGlbPath)) {
      const glbBuffer = fs.readFileSync(cacheGlbPath);
      return new Response(glbBuffer, {
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': glbBuffer.length,
        },
      });
    }

    // If already converted as GLTF, return it
    if (fs.existsSync(cacheGltfPath)) {
      let gltfBuffer = fs.readFileSync(cacheGltfPath);
      let gltfJson = JSON.parse(gltfBuffer.toString());

      // Update buffer URIs to point to our bin endpoint
      if (gltfJson.buffers) {
        for (let buffer of gltfJson.buffers) {
          if (buffer.uri && !buffer.uri.startsWith('http')) {
            buffer.uri = `/api/public/${token}/convert-3d?bin=true`;
          }
        }
      }

      gltfBuffer = Buffer.from(JSON.stringify(gltfJson));
      return new Response(gltfBuffer, {
        headers: {
          'Content-Type': 'model/gltf+json',
          'Content-Length': gltfBuffer.length,
        },
      });
    }

    // If requesting bin file and it exists, return it
    if (binRequest && fs.existsSync(cacheBinPath)) {
      const binBuffer = fs.readFileSync(cacheBinPath);
      return new Response(binBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': binBuffer.length,
        },
      });
    }

    // Convert 3D file to GLB using Assimp
    try {
      const tempDir = join(RESOLVED_CACHE_DIR, '.temp');

      try {
        await fsPromises.mkdir(tempDir, { recursive: true, mode: 0o755 });
      } catch (mkdirError) {
        return NextResponse.json({ error: 'Failed to create temporary directory' }, { status: 500 });
      }

      const tempInputPath = join(tempDir, `input_${fileHash}.${fileExt}`);
      const tempGLBPath = join(tempDir, `output_${fileHash}.glb`);
      const tempGltfPath = join(tempDir, `output_${fileHash}.gltf`);
      const tempBinPath = join(tempDir, `output_${fileHash}.bin`);

      try {
        await fsPromises.copyFile(fullPath, tempInputPath);
      } catch (copyError) {
        return NextResponse.json({ error: 'Failed to prepare file for conversion' }, { status: 500 });
      }

      try {
        const inputPath = tempInputPath.replace(/\\/g, '/');
        const glbOutput = tempGLBPath.replace(/\\/g, '/');
        const gltfOutput = tempGltfPath.replace(/\\/g, '/');

        let conversionSuccess = false;

        // Try GLB first
        try {
          await execPromise(`assimp export "${inputPath}" "${glbOutput}" -fglb2`);
          if (fs.existsSync(tempGLBPath)) {
            await fsPromises.copyFile(tempGLBPath, cacheGlbPath);
            conversionSuccess = true;
          }
        } catch (glbError) {
          // Fall back to GLTF
        }

        // If GLB failed, try GLTF
        if (!conversionSuccess) {
          await execPromise(`assimp export "${inputPath}" "${gltfOutput}" -fgltf2`);

          if (fs.existsSync(tempGltfPath)) {
            await fsPromises.copyFile(tempGltfPath, cacheGltfPath);

            if (fs.existsSync(tempBinPath)) {
              await fsPromises.copyFile(tempBinPath, cacheBinPath);
            }

            conversionSuccess = true;
          }
        }

        if (!conversionSuccess) {
          throw new Error('Assimp export produced no output file');
        }
      } finally {
        // Clean up temp files
        const filesToClean = [tempInputPath, tempGLBPath, tempGltfPath, tempBinPath];
        for (const file of filesToClean) {
          if (fs.existsSync(file)) {
            try {
              await fsPromises.unlink(file);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        }
      }
    } catch (error) {
      return NextResponse.json({ error: 'Failed to convert 3D file: ' + error.message }, { status: 500 });
    }

    // Return the cached file
    let cachePath;
    if (fs.existsSync(cacheGlbPath)) {
      cachePath = cacheGlbPath;
    } else if (fs.existsSync(cacheGltfPath)) {
      cachePath = cacheGltfPath;
    } else {
      return NextResponse.json({ error: 'Conversion failed' }, { status: 500 });
    }

    const fileBuffer = fs.readFileSync(cachePath);
    const contentType = cachePath.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
      },
    });
  } catch (error) {
    console.error('Public convert-3d error:', error);
    return NextResponse.json({ error: 'Conversion failed: ' + error.message }, { status: 500 });
  }
}
