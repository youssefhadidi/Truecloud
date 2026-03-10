/** @format */

import chokidar from 'chokidar';
import { PrismaClient } from '@prisma/client';
import { extname, dirname } from 'path';

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

const logger = {
  debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data || ''),
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const IGNORED_PATTERNS = ['.thumbnails', 'opti-cache', '.stream-cache', '.cache', 'node_modules', 'iocage', 'clientmqueue'];

let watcher = null;
let isWatching = false;

/**
 * Extract owner ID from path (e.g., "user_abc123/file.txt" -> "abc123")
 */
function extractOwnerId(relativePath) {
  const firstSegment = relativePath.split(/[\\/]/)[0];
  if (firstSegment?.startsWith('user_')) {
    return firstSegment.replace('user_', '');
  }
  return null; // shared folder
}

/**
 * Extract file extension (lowercase, without dot)
 */
function getExtension(fileName) {
  const ext = extname(fileName).toLowerCase();
  return ext ? ext.substring(1) : '';
}

/**
 * Get parent directory path relative to UPLOAD_DIR
 */
function getParentPath(relativePath) {
  const parentDir = dirname(relativePath);
  return parentDir === '.' ? '' : parentDir;
}

/**
 * Upsert file index entry
 */
async function upsertFileIndex(relativePath, isDirectory, size = 0) {
  try {
    const name = relativePath.split(/[\\/]/).pop();
    const ownerId = extractOwnerId(relativePath);
    const extension = getExtension(name);
    const parentPath = getParentPath(relativePath);

    await prisma.fileIndex.upsert({
      where: { path: relativePath },
      update: {
        name,
        parentPath,
        extension,
        size: BigInt(size),
        isDirectory,
        lastModified: new Date(),
        indexedAt: new Date(),
      },
      create: {
        path: relativePath,
        name,
        parentPath,
        extension,
        size: BigInt(size),
        isDirectory,
        ownerId,
        lastModified: new Date(),
        indexedAt: new Date(),
      },
    });

    logger.debug('FileIndex upserted', { path: relativePath, isDirectory });
  } catch (error) {
    logger.error('Error upserting FileIndex', { path: relativePath, error: error.message });
  }
}

/**
 * Delete file index entry
 */
async function deleteFileIndex(relativePath) {
  try {
    await prisma.fileIndex.delete({
      where: { path: relativePath },
    });
    logger.debug('FileIndex deleted', { path: relativePath });
  } catch (error) {
    if (error.code !== 'P2025') {
      logger.error('Error deleting FileIndex', { path: relativePath, error: error.message });
    }
  }
}

/**
 * Start file watcher
 */
export function startFileWatcher() {
  if (watcher) {
    logger.warn('FileWatcher already running');
    return;
  }

  logger.info('Starting FileWatcher', { uploadDir: UPLOAD_DIR });

  watcher = chokidar.watch(UPLOAD_DIR, {
    ignored: (path) => IGNORED_PATTERNS.some((pattern) => path.includes(pattern)),
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignoreInitial: true,
    depth: 10,
  });

  watcher
    .on('add', async (filePath) => {
      const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      try {
        const { size } = await import('fs/promises').then((fs) => fs.stat(filePath));
        await upsertFileIndex(relativePath, false, size);
      } catch (error) {
        logger.error('FileWatcher: error on add', { filePath, error: error.message });
      }
    })
    .on('addDir', async (dirPath) => {
      const relativePath = dirPath.replace(UPLOAD_DIR, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      await upsertFileIndex(relativePath, true);
    })
    .on('change', async (filePath) => {
      const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      try {
        const { size } = await import('fs/promises').then((fs) => fs.stat(filePath));
        await prisma.fileIndex.update({
          where: { path: relativePath },
          data: {
            size: BigInt(size),
            lastModified: new Date(),
            indexedAt: new Date(),
          },
        });
        logger.debug('FileIndex updated (change)', { path: relativePath });
      } catch (error) {
        logger.error('FileWatcher: error on change', { filePath, error: error.message });
      }
    })
    .on('unlink', async (filePath) => {
      const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      await deleteFileIndex(relativePath);
    })
    .on('unlinkDir', async (dirPath) => {
      const relativePath = dirPath.replace(UPLOAD_DIR, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      await deleteFileIndex(relativePath);
    })
    .on('error', (error) => {
      logger.error('FileWatcher error', { error: error.message });
    })
    .on('ready', () => {
      isWatching = true;
      logger.info('FileWatcher ready and monitoring');
    });
}

/**
 * Stop file watcher
 */
export async function stopFileWatcher() {
  if (!watcher) {
    logger.warn('FileWatcher not running');
    return;
  }

  logger.info('Stopping FileWatcher');
  await watcher.close();
  watcher = null;
  isWatching = false;
}

/**
 * Get watcher status
 */
export function getWatcherStatus() {
  return {
    watching: isWatching,
  };
}
