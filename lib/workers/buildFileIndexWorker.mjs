/** @format */

import { readdir, stat } from 'fs/promises';
import { extname, dirname, join, relative } from 'path';
import { PrismaClient } from '@prisma/client';
import { shouldSkipScanEntry } from '../cachePaths.mjs';

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

  try {
    const items = await readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dirPath, item.name);

      // Skip ignored directories, plus any cache dir configured inside UPLOAD_DIR
      if (shouldSkipScanEntry(item.name, fullPath)) continue;

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
    console.error('Starting file index rebuild...');
    process.stdout.write(JSON.stringify({ type: 'progress', processed: 0, total: 0 }) + '\n');

    // Walk entire directory tree
    const allEntries = await walkDirectory(UPLOAD_DIR);

    console.error(`Found ${allEntries.length} entries to index`);
    process.stdout.write(JSON.stringify({ type: 'progress', processed: 0, total: allEntries.length }) + '\n');

    // Batch insert in chunks using transactions (SQLite can't handle concurrent writes)
    const batchSize = 500;
    for (let i = 0; i < allEntries.length; i += batchSize) {
      const batch = allEntries.slice(i, i + batchSize);
      const now = new Date();

      await prisma.$transaction(
        batch.map((entry) =>
          prisma.fileIndex.upsert({
            where: { path: entry.path },
            update: {
              name: entry.name,
              parentPath: getParentPath(entry.path),
              extension: getExtension(entry.name),
              size: entry.size,
              isDirectory: entry.isDirectory,
              lastModified: now,
              indexedAt: now,
            },
            create: {
              path: entry.path,
              name: entry.name,
              parentPath: getParentPath(entry.path),
              extension: getExtension(entry.name),
              size: entry.size,
              isDirectory: entry.isDirectory,
              ownerId: extractOwnerId(entry.path),
              lastModified: now,
              indexedAt: now,
            },
          }),
        ),
      );

      const processed = Math.min(i + batchSize, allEntries.length);
      process.stdout.write(JSON.stringify({ type: 'progress', processed, total: allEntries.length }) + '\n');
    }

    await prisma.$disconnect();
    process.stdout.write(JSON.stringify({ type: 'done', total: allEntries.length }) + '\n');
    process.exit(0);
  } catch (error) {
    console.error('Error building index:', error);
    await prisma.$disconnect();
    process.stdout.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
    process.exit(1);
  }
}

buildIndex();
