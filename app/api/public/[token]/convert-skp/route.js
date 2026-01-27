/** @format */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { verifyShare, validateSharePath } from '@/lib/shareAuth';

const execPromise = promisify(exec);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const CACHE_DIR = process.env.CACHE_DIR || './.cache';

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

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

    // Check if it's an SKP file
    const actualFileName = pathCheck.fullPath.split('/').pop();
    if (!actualFileName.toLowerCase().endsWith('.skp')) {
      return NextResponse.json({ error: 'Not an SKP file' }, { status: 400 });
    }

    // Generate cache filename using hash
    const fileHash = createHash('md5').update(`${token}_${actualFileName}`).digest('hex');
    const cacheFileName = `${fileHash}.glb`;
    const cachePath = join(CACHE_DIR, cacheFileName);

    // If already converted, return it
    if (fs.existsSync(cachePath)) {
      const glbBuffer = fs.readFileSync(cachePath);
      return new Response(glbBuffer, {
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': glbBuffer.length,
        },
      });
    }

    // Convert SKP to GLB using Assimp
    try {
      const tempDir = join(UPLOAD_DIR, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create temp files with simple ASCII names to avoid encoding issues
      const tempInputPath = join(tempDir, `input_${fileHash}.skp`);
      const tempOutputPath = join(tempDir, `output_${fileHash}.glb`);

      // Copy original file to temp location
      fs.copyFileSync(fullPath, tempInputPath);

      try {
        // Use forward slashes and proper escaping
        const inputPath = tempInputPath.replace(/\\/g, '/');
        const outputPath = tempOutputPath.replace(/\\/g, '/');

        await execPromise(`assimp export "${inputPath}" "${outputPath}" -fgltf2`);

        // Move converted file to cache
        fs.copyFileSync(tempOutputPath, cachePath);
      } finally {
        // Clean up temp files
        try {
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp files:', cleanupError);
        }
      }
    } catch (error) {
      console.error('Assimp conversion error:', error);
      return NextResponse.json({ error: 'Failed to convert SKP file' }, { status: 500 });
    }

    // Read and return the converted file
    const glbBuffer = fs.readFileSync(cachePath);
    return new Response(glbBuffer, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': glbBuffer.length,
      },
    });
  } catch (error) {
    console.error('Public convert-skp error:', error);
    return NextResponse.json({ error: 'Conversion failed: ' + error.message }, { status: 500 });
  }
}
