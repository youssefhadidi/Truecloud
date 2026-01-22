/** @format */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { join, extname, resolve, sep } from 'node:path';
import { createHash } from 'crypto';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { logger } from '@/lib/logger';

const execPromise = promisify(exec);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const CACHE_DIR = process.env.CACHE_DIR || './cache';

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Formats that don't need conversion
const NO_CONVERSION_NEEDED = ['glb', 'gltf'];

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileName = decodeURIComponent(searchParams.get('id') || '');
    const binRequest = searchParams.get('bin') === 'true';
    let relativePath = searchParams.get('path') || '';

    if (!fileName) {
      return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
    }

    // Check user permissions
    const isRoot = await hasRootAccess(session.user.id);
    const accessCheck = checkPathAccess({
      userId: session.user.id,
      path: relativePath,
      operation: 'read',
      isRootUser: isRoot,
    });

    if (!accessCheck.allowed) {
      logger.warn('GET /api/files/convert-3d - Access denied', {
        requestedPath: relativePath,
        userId: session.user.id,
        reason: accessCheck.error,
      });
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status });
    }

    relativePath = accessCheck.normalizedPath;

    const fullPath = join(UPLOAD_DIR, relativePath, fileName);

    // Security: prevent directory traversal
    const resolvedTarget = resolve(fullPath) + sep;
    if (!resolvedTarget.startsWith(RESOLVED_UPLOAD_DIR)) {
      logger.error('GET /api/files/convert-3d - Directory traversal attempt', {
        fileName,
        resolvedTarget,
        user: session.user.email,
      });
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
    const fileHash = createHash('md5').update(fileName).digest('hex');
    const cacheGlbPath = join(CACHE_DIR, `${fileHash}.glb`);
    const cacheGltfPath = join(CACHE_DIR, `${fileHash}.gltf`);
    const cacheBinPath = join(CACHE_DIR, `${fileHash}.bin`);

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

    // If already converted as GLTF, modify it to reference the bin file correctly
    if (fs.existsSync(cacheGltfPath)) {
      let gltfBuffer = fs.readFileSync(cacheGltfPath);
      let gltfJson = JSON.parse(gltfBuffer.toString());

      // Update all buffer URIs to point to our bin endpoint
      if (gltfJson.buffers) {
        for (let buffer of gltfJson.buffers) {
          if (buffer.uri && !buffer.uri.startsWith('http')) {
            // Replace with our bin endpoint
            buffer.uri = `/api/files/convert-3d?id=${encodeURIComponent(fileName)}&bin=true`;
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

    // Convert 3D file to GLB using Assimp
    try {
      const tempDir = join(UPLOAD_DIR, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create temp files with simple ASCII names to avoid encoding issues
      const tempInputPath = join(tempDir, `input.${fileExt}`);
      const tempGLBPath = join(tempDir, 'output.glb');
      const tempGltfPath = join(tempDir, 'output.gltf');
      const tempBinPath = join(tempDir, 'output.bin');

      // Copy original file to temp location
      fs.copyFileSync(fullPath, tempInputPath);

      try {
        // Use forward slashes and proper escaping
        const inputPath = tempInputPath.replace(/\\/g, '/');
        const glbOutput = tempGLBPath.replace(/\\/g, '/');
        const gltfOutput = tempGltfPath.replace(/\\/g, '/');

        // Try GLB export first (binary format, single file)
        let conversionSuccess = false;
        try {
          await execPromise(`assimp export "${inputPath}" "${glbOutput}" -fglb2`);
          if (fs.existsSync(tempGLBPath)) {
            fs.copyFileSync(tempGLBPath, cacheGlbPath);
            conversionSuccess = true;
            console.log(`Converted ${fileName} to GLB`);
          }
        } catch (glbError) {
          console.warn(`GLB export failed for ${fileName}, trying GLTF:`, glbError.message);
        }

        // If GLB failed, fall back to GLTF with separate bin file
        if (!conversionSuccess) {
          await execPromise(`assimp export "${inputPath}" "${gltfOutput}" -fgltf2`);

          if (fs.existsSync(tempGltfPath)) {
            // Copy GLTF file
            fs.copyFileSync(tempGltfPath, cacheGltfPath);

            // Copy associated bin file if it exists
            if (fs.existsSync(tempBinPath)) {
              fs.copyFileSync(tempBinPath, cacheBinPath);
            }

            conversionSuccess = true;
            console.log(`Converted ${fileName} to GLTF+BIN`);
          }
        }

        if (!conversionSuccess) {
          throw new Error('Assimp export produced no output file');
        }
      } finally {
        // Clean up temp files
        try {
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempGLBPath)) fs.unlinkSync(tempGLBPath);
          if (fs.existsSync(tempGltfPath)) fs.unlinkSync(tempGltfPath);
          if (fs.existsSync(tempBinPath)) fs.unlinkSync(tempBinPath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp files:', cleanupError);
        }
      }
    } catch (error) {
      console.error('Assimp conversion error:', error);
      return NextResponse.json({ error: 'Failed to convert 3D file: ' + error.message }, { status: 500 });
    }

    // Return the appropriate cached file (GLB or GLTF)
    let cachePath;
    if (fs.existsSync(cacheGlbPath)) {
      cachePath = cacheGlbPath;
    } else if (fs.existsSync(cacheGltfPath)) {
      cachePath = cacheGltfPath;
    } else {
      return NextResponse.json({ error: 'Conversion failed: no output file generated' }, { status: 500 });
    }

    // Read and return the converted file
    const fileBuffer = fs.readFileSync(cachePath);
    const contentType = cachePath.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
      },
    });
  } catch (error) {
    console.error('Conversion error:', error);
    return NextResponse.json({ error: 'Conversion failed: ' + error.message }, { status: 500 });
  }
}
