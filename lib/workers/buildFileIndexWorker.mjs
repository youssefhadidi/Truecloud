/** @format */

import { readdir, stat } from 'fs/promises';
import { resolve, extname, dirname, join, relative } from 'path';
import { PrismaClient } from '@prisma/client';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const prisma = new PrismaClient();

/**
 * Extract owner ID from path
 */
function extractOwnerId(relativePath) {
  const firstSegment = relativePath.split(/[\\/]/)[0];
  if (firstSegment?.startsWith('user_')) {
    return firstSegment.replace('user_', '');
  }
  return null;
}

/**
 * Extract file extension
 */
function getExtension(fileName) {
  const ext = extname(fileName).toLowerCase();
  return ext ? ext.substring(1) : '';
}

/**
 * Get parent directory path
 */
function getParentPath(relativePath) {
  const parentDir = dirname(relativePath);
  return parentDir === '.' ? '' : parentDir;
}

/**
 * Recursively walk directory and collect files
 */
async function walkDirectory(dirPath, baseDir = UPLOAD_DIR) {
  const entries = [];
  const IGNORED = ['.thumbnails', 'opti-cache', '.stream-cache', '.cache', 'node_modules'];

  try {
    const items = await readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      // Skip ignored directories
      if (IGNORED.includes(item.name)) continue;

      const fullPath = join(dirPath, item.name);
      const relativePath = relative(baseDir, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        entries.push({
          path: relativePath,
          name: item.name,
          isDirectory: true,
          size: 0n,
        });
        // Recursively walk subdirectories
        const subEntries = await walkDirectory(fullPath, baseDir);
        entries.push(...subEntries);
      } else {
        try {
          const fileStats = await stat(fullPath);
          entries.push({
            path: relativePath,
            name: item.name,
            isDirectory: false,
            size: BigInt(fileStats.size),
          });
        } catch (error) {
          console.error(`Error stat file: ${fullPath}`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory: ${dirPath}`, error.message);
  }

  return entries;
}

/**
 * Main worker function
 */
async function buildIndex() {
  try {
    console.log('Starting file index rebuild...');
    process.send({ type: 'progress', processed: 0, total: 0 });

    // Walk entire directory tree
    const allEntries = await walkDirectory(UPLOAD_DIR);

    console.log(`Found ${allEntries.length} entries to index`);
    process.send({ type: 'progress', processed: 0, total: allEntries.length });

    // Batch upsert in chunks of 1000
    const batchSize = 1000;
    for (let i = 0; i < allEntries.length; i += batchSize) {
      const batch = allEntries.slice(i, i + batchSize);

      await Promise.all(
        batch.map((entry) =>
          prisma.fileIndex.upsert({
            where: { path: entry.path },
            update: {
              name: entry.name,
              parentPath: getParentPath(entry.path),
              extension: getExtension(entry.name),
              size: entry.size,
              isDirectory: entry.isDirectory,
              lastModified: new Date(),
              indexedAt: new Date(),
            },
            create: {
              path: entry.path,
              name: entry.name,
              parentPath: getParentPath(entry.path),
              extension: getExtension(entry.name),
              size: entry.size,
              isDirectory: entry.isDirectory,
              ownerId: extractOwnerId(entry.path),
              lastModified: new Date(),
              indexedAt: new Date(),
            },
          }),
        ),
      );

      const processed = Math.min(i + batchSize, allEntries.length);
      process.send({ type: 'progress', processed, total: allEntries.length });
      console.log(`Progress: ${processed}/${allEntries.length}`);
    }

    await prisma.$disconnect();
    process.send({ type: 'done', total: allEntries.length });
    process.exit(0);
  } catch (error) {
    console.error('Error building index:', error);
    await prisma.$disconnect();
    process.send({ type: 'error', error: error.message });
    process.exit(1);
  }
}

buildIndex();
