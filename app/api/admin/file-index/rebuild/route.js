/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { join } from 'node:path';

// Global state to track rebuild progress
let rebuildProcess = null;
let rebuildProgress = { processed: 0, total: 0 };

export async function POST(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    // Check if rebuild already in progress
    if (rebuildProcess && !rebuildProcess.killed) {
      return NextResponse.json({ error: 'Rebuild already in progress' }, { status: 409 });
    }

    // Clear existing index
    await prisma.fileIndex.deleteMany({});

    // Spawn background worker (dynamic import avoids Turbopack resolving the worker path)
    const { spawn } = await import('child_process');
    const workerPath = join(process.cwd(), 'lib', 'workers', 'buildFileIndexWorker.mjs');

    rebuildProcess = spawn(process.execPath, [workerPath], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    // Track progress via IPC
    rebuildProcess.on('message', (msg) => {
      if (msg.type === 'progress') {
        rebuildProgress = { processed: msg.processed, total: msg.total };
        // Broadcast to connected clients via WebSocket
        global.broadcastFileIndexUpdate?.({
          type: 'progress',
          processed: msg.processed,
          total: msg.total,
        });
      } else if (msg.type === 'done') {
        rebuildProgress = { processed: msg.total, total: msg.total };
        global.broadcastFileIndexUpdate?.({
          type: 'done',
          total: msg.total,
        });
        rebuildProcess = null;
      } else if (msg.type === 'error') {
        global.broadcastFileIndexUpdate?.({
          type: 'error',
          error: msg.error,
        });
        rebuildProcess = null;
      }
    });

    rebuildProcess.on('error', (error) => {
      console.error('Rebuild worker error:', error);
      global.broadcastFileIndexUpdate?.({
        type: 'error',
        error: error.message,
      });
      rebuildProcess = null;
    });

    rebuildProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Rebuild worker exited with code ${code}`);
      }
      rebuildProcess = null;
    });

    return NextResponse.json({ success: true, message: 'Rebuild started' });
  } catch (error) {
    console.error('File index rebuild error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET — get current rebuild progress
 */
export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    return NextResponse.json({
      inProgress: rebuildProcess && !rebuildProcess.killed,
      progress: rebuildProgress,
    });
  } catch (error) {
    console.error('Get rebuild status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
