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

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileName = decodeURIComponent(searchParams.get('id') || '');

    if (!fileName) {
      return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
    }

    const fullPath = path.join(UPLOAD_DIR, fileName);

    // Verify file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if it's an SKP file
    if (!fileName.toLowerCase().endsWith('.skp')) {
      return NextResponse.json({ error: 'Not an SKP file' }, { status: 400 });
    }

    // Generate cache filename using hash (avoids special character issues)
    const fileHash = createHash('md5').update(fileName).digest('hex');
    const cacheFileName = `${fileHash}.glb`;
    const cachePath = path.join(CACHE_DIR, cacheFileName);

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
      const tempDir = path.join(UPLOAD_DIR, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create temp files with simple ASCII names to avoid encoding issues
      const tempInputPath = path.join(tempDir, 'input.skp');
      const tempOutputPath = path.join(tempDir, 'output.glb');

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
      return NextResponse.json({ error: 'Failed to convert SKP file. Make sure Assimp is installed with SketchUp support.' }, { status: 500 });
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
    console.error('Conversion error:', error);
    return NextResponse.json({ error: 'Conversion failed: ' + error.message }, { status: 500 });
  }
}
