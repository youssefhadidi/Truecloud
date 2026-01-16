/** @format */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';

const execPromise = promisify(exec);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const CACHE_DIR = path.join(UPLOAD_DIR, '.cache');

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

    if (!fileName) {
      return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
    }

    // Handle bin file request
    if (binRequest) {
      const fileHash = createHash('md5').update(fileName).digest('hex');
      const cacheBinPath = path.join(CACHE_DIR, `${fileHash}.bin`);

      if (!fs.existsSync(cacheBinPath)) {
        return NextResponse.json({ error: 'Bin file not found' }, { status: 404 });
      }

      const binBuffer = fs.readFileSync(cacheBinPath);
      return new Response(binBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': binBuffer.length,
        },
      });
    }

    const fullPath = path.join(UPLOAD_DIR, fileName);

    // Verify file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileExt = path.extname(fileName).toLowerCase().slice(1);

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
    const cacheGlbPath = path.join(CACHE_DIR, `${fileHash}.glb`);
    const cacheGltfPath = path.join(CACHE_DIR, `${fileHash}.gltf`);
    const cacheBinPath = path.join(CACHE_DIR, `${fileHash}.bin`);

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
      const tempDir = path.join(UPLOAD_DIR, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create temp files with simple ASCII names to avoid encoding issues
      const tempInputPath = path.join(tempDir, `input.${fileExt}`);
      const tempGLBPath = path.join(tempDir, 'output.glb');
      const tempGltfPath = path.join(tempDir, 'output.gltf');
      const tempBinPath = path.join(tempDir, 'output.bin');

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
