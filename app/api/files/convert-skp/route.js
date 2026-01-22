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

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileName = decodeURIComponent(searchParams.get('id') || '');
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
      logger.warn('GET /api/files/convert-skp - Access denied', {
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
      logger.error('GET /api/files/convert-skp - Directory traversal attempt', {
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

    // Check if it's an SKP file
    if (!fileName.toLowerCase().endsWith('.skp')) {
      return NextResponse.json({ error: 'Not an SKP file' }, { status: 400 });
    }

    // Generate cache filename using hash (avoids special character issues)
    const fileHash = createHash('md5').update(fileName).digest('hex');
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
      const tempInputPath = join(tempDir, 'input.skp');
      const tempOutputPath = join(tempDir, 'output.glb');

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
