/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { resolve } from 'node:path';
import fsPromises from 'fs/promises';
import { thumbnailCache } from '@/lib/thumbnailCache';

// Cache directory configurations
const CACHE_DIRS = {
  thumbnails: {
    name: 'Thumbnails',
    description: 'Image, video, and PDF thumbnails',
    envVar: 'THUMBNAIL_DIR',
    defaultPath: './.thumbnails',
  },
  optimized: {
    name: 'Optimized Images',
    description: 'Optimized WebP images for viewing',
    envVar: 'OPTI_CACHE_DIR',
    defaultPath: './opti-cache',
  },
  stream: {
    name: 'Stream Cache',
    description: 'Fixed MP4 files for streaming',
    envVar: 'STREAM_CACHE_DIR',
    defaultPath: './.stream-cache',
  },
  hls: {
    name: 'HLS Transcodes',
    description: 'Adaptive bitrate HLS video transcodes (360p/720p/1080p)',
    envVar: 'HLS_CACHE_DIR',
    defaultPath: './hls-cache',
  },
  '3d': {
    name: '3D/SKP Cache',
    description: '3D and SketchUp file conversions',
    envVar: 'CACHE_DIR',
    defaultPath: './.cache',
  },
};

// Helper to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper to get directory stats recursively
async function getDirectoryStats(dirPath) {
  let totalSize = 0;
  let fileCount = 0;

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = resolve(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subStats = await getDirectoryStats(fullPath);
        totalSize += subStats.totalSize;
        fileCount += subStats.fileCount;
      } else if (entry.isFile()) {
        try {
          const stats = await fsPromises.stat(fullPath);
          totalSize += stats.size;
          fileCount++;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    return { totalSize: 0, fileCount: 0 };
  }

  return { totalSize, fileCount };
}

// Helper to clear directory contents
async function clearDirectory(dirPath) {
  let freedSpace = 0;
  let filesDeleted = 0;

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = resolve(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subResult = await clearDirectory(fullPath);
        freedSpace += subResult.freedSpace;
        filesDeleted += subResult.filesDeleted;
        // Remove the empty directory
        try {
          await fsPromises.rmdir(fullPath);
        } catch {
          // Directory might not be empty or already removed
        }
      } else if (entry.isFile()) {
        try {
          const stats = await fsPromises.stat(fullPath);
          freedSpace += stats.size;
          await fsPromises.unlink(fullPath);
          filesDeleted++;
        } catch {
          // Skip files we can't delete
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }

  return { freedSpace, filesDeleted };
}

// GET - Get cache statistics
export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const caches = [];
    let totalSize = 0;

    for (const [type, config] of Object.entries(CACHE_DIRS)) {
      const dirPath = resolve(process.cwd(), process.env[config.envVar] || config.defaultPath);
      const stats = await getDirectoryStats(dirPath);

      caches.push({
        type,
        name: config.name,
        description: config.description,
        path: process.env[config.envVar] || config.defaultPath,
        size: stats.totalSize,
        sizeFormatted: formatBytes(stats.totalSize),
        fileCount: stats.fileCount,
      });

      totalSize += stats.totalSize;
    }

    return NextResponse.json({
      caches,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    return NextResponse.json({ error: 'Failed to get cache statistics' }, { status: 500 });
  }
}

// DELETE - Clear cache
export async function DELETE(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');

    if (!type) {
      return NextResponse.json({ error: 'Cache type is required' }, { status: 400 });
    }

    // Handle "all" type
    if (type === 'all') {
      let totalFreedSpace = 0;
      let totalFilesDeleted = 0;
      const results = [];

      for (const [cacheType, config] of Object.entries(CACHE_DIRS)) {
        const dirPath = resolve(process.cwd(), process.env[config.envVar] || config.defaultPath);
        const result = await clearDirectory(dirPath);
        totalFreedSpace += result.freedSpace;
        totalFilesDeleted += result.filesDeleted;
        results.push({
          type: cacheType,
          filesDeleted: result.filesDeleted,
          freedSpace: result.freedSpace,
        });
        // Clear in-memory thumbnail cache when clearing disk thumbnails
        if (cacheType === 'thumbnails') {
          thumbnailCache.clear();
        }
      }

      return NextResponse.json({
        success: true,
        cleared: 'all',
        results,
        freedSpace: totalFreedSpace,
        freedSpaceFormatted: formatBytes(totalFreedSpace),
        filesDeleted: totalFilesDeleted,
      });
    }

    // Handle specific cache type
    const config = CACHE_DIRS[type];
    if (!config) {
      return NextResponse.json({ error: 'Invalid cache type' }, { status: 400 });
    }

    const dirPath = resolve(process.cwd(), process.env[config.envVar] || config.defaultPath);
    const result = await clearDirectory(dirPath);

    // Clear in-memory thumbnail cache when clearing disk thumbnails
    if (type === 'thumbnails') {
      thumbnailCache.clear();
    }

    return NextResponse.json({
      success: true,
      cleared: type,
      freedSpace: result.freedSpace,
      freedSpaceFormatted: formatBytes(result.freedSpace),
      filesDeleted: result.filesDeleted,
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}
