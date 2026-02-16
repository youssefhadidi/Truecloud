/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { getWatcherStatus } from '@/lib/fileWatcher';

export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    // Count files and directories
    const totalFiles = await prisma.fileIndex.count({
      where: { isDirectory: false },
    });

    const totalDirs = await prisma.fileIndex.count({
      where: { isDirectory: true },
    });

    // Get last indexed date (earliest indexedAt = first rebuild)
    const lastIndex = await prisma.fileIndex.findFirst({
      orderBy: { indexedAt: 'asc' },
      select: { indexedAt: true },
    });

    const watcherStatus = getWatcherStatus();

    return NextResponse.json({
      totalFiles,
      totalDirs,
      lastIndexed: lastIndex?.indexedAt || null,
      watcherActive: watcherStatus.watching,
    });
  } catch (error) {
    console.error('File index stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
