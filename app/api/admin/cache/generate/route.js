/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { resolve, join } from 'node:path';
import fsPromises from 'fs/promises';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const { path: targetPath = '', type = 'thumbnails' } = body;

    if (!['thumbnails', 'optimized', 'stream', 'both', 'all'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Resolve directory
    const uploadDir = resolve(process.cwd(), UPLOAD_DIR);
    const scanDir = targetPath ? join(uploadDir, targetPath) : uploadDir;

    // Verify directory exists
    try {
      const stats = await fsPromises.stat(scanDir);
      if (!stats.isDirectory()) {
        return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }

    // Initialize cache generation status
    global.cacheGenerationStatus = {
      isRunning: true,
      type,
      processed: 0,
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      currentFile: null,
      startTime: new Date(),
      endTime: null,
      success: null,
      error: null,
      duration: 0,
    };

    // Track if generation was manually cancelled
    global.cacheGenerationCancelled = false;

    // Broadcast initial status
    if (global.broadcastCacheGenerationUpdate) {
      global.broadcastCacheGenerationUpdate({
        type: 'status',
        payload: global.cacheGenerationStatus,
      });
    }

    // Spawn child process for generation (spawn avoids Turbopack resolving the worker path)
    const { spawn } = await import('child_process');
    const workerPath = join(process.cwd(), 'lib', 'workers', 'generateCacheWorker.mjs');
    const child = spawn(process.execPath, [workerPath], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    // Store child process reference globally so it can be killed later
    global.cacheGenerationChild = child;

    // Log stderr for debugging
    child.stderr.on('data', (data) => {
      console.error('Worker stderr:', data.toString());
    });

    // Send config to child process
    child.send({
      scanDir,
      targetPath,
      type,
      thumbnailDir: THUMBNAIL_DIR,
      optiCacheDir: OPTI_CACHE_DIR,
      streamCacheDir: STREAM_CACHE_DIR,
      cwd: process.cwd(),
    });

    // Handle messages from child process
    child.on('message', (data) => {
      try {
        // Ignore progress messages after cancellation, but allow final status messages (cancelled, error, complete)
        if (global.cacheGenerationCancelled && data.status === 'progress') {
          console.error('[CACHE] Ignoring progress message after cancellation');
          return;
        }

        if (data.status === 'scanning' || data.status === 'starting') {
          global.cacheGenerationStatus.total = data.total || global.cacheGenerationStatus.total;
        } else if (data.status === 'progress') {
          global.cacheGenerationStatus.processed = data.processed;
          global.cacheGenerationStatus.total = data.total;
          global.cacheGenerationStatus.successful = data.successful;
          global.cacheGenerationStatus.failed = data.failed;
          global.cacheGenerationStatus.skipped = data.skipped;
          global.cacheGenerationStatus.currentFile = data.current;
        } else if (data.status === 'cancelled') {
          console.error('[CACHE] >>> RECEIVED CANCELLED MESSAGE <<<');
          console.error('[CACHE] Cancellation confirmed - isRunning: true -> false');
          global.cacheGenerationStatus.isRunning = false;
          global.cacheGenerationStatus.success = false;
          global.cacheGenerationStatus.error = 'Cache generation cancelled by user';
          global.cacheGenerationStatus.endTime = new Date();
          global.cacheGenerationStatus.processed = data.processed;
          global.cacheGenerationStatus.total = data.total;
          global.cacheGenerationStatus.successful = data.successful;
          global.cacheGenerationStatus.failed = data.failed;
          global.cacheGenerationStatus.skipped = data.skipped;
          // Clean up cancel handler
          if (global.cacheGenerationCancelHandler) {
            global.cacheGenerationCancelHandler = null;
          }
        } else if (data.status === 'complete') {
          console.error('[CACHE] Received complete message');
          global.cacheGenerationStatus.isRunning = false;
          global.cacheGenerationStatus.success = true;
          global.cacheGenerationStatus.endTime = new Date();
          global.cacheGenerationStatus.duration = data.duration || 0;
          global.cacheGenerationStatus.processed = data.processed;
          global.cacheGenerationStatus.total = data.total;
          global.cacheGenerationStatus.successful = data.successful;
          global.cacheGenerationStatus.failed = data.failed;
          global.cacheGenerationStatus.skipped = data.skipped;
        } else if (data.status === 'error') {
          global.cacheGenerationStatus.isRunning = false;
          global.cacheGenerationStatus.success = false;
          global.cacheGenerationStatus.error = data.message;
          global.cacheGenerationStatus.endTime = new Date();
        }

        // Broadcast update (ignore progress updates after cancellation, but always broadcast cancelled/complete/error)
        const shouldBroadcast = global.broadcastCacheGenerationUpdate &&
          (!global.cacheGenerationCancelled || data.status === 'cancelled' || data.status === 'error' || data.status === 'complete');

        if (shouldBroadcast) {
          console.error(`[CACHE] Broadcasting ${data.status} update`);
          global.broadcastCacheGenerationUpdate({
            type: 'status',
            payload: global.cacheGenerationStatus,
          });
        }
      } catch (err) {
        console.error('Error processing worker message:', err);
      }
    });

    child.on('error', (err) => {
      // Don't broadcast error if it was manually cancelled
      if (global.cacheGenerationCancelled) {
        console.error('[CACHE] Ignoring error event after cancellation:', err.message);
        return;
      }

      console.error('[CACHE] Error event broadcast:', err.message);

      global.cacheGenerationStatus.isRunning = false;
      global.cacheGenerationStatus.success = false;
      global.cacheGenerationStatus.error = err.message;
      global.cacheGenerationStatus.endTime = new Date();

      if (global.broadcastCacheGenerationUpdate) {
        global.broadcastCacheGenerationUpdate({
          type: 'status',
          payload: global.cacheGenerationStatus,
        });
      }
    });

    child.on('exit', (code) => {
      // Clean up the reference
      global.cacheGenerationChild = null;

      // Don't broadcast on exit if already handled by cancelled status
      if (global.cacheGenerationCancelled) {
        console.error('[CACHE] Ignoring exit event after cancellation, code:', code);
        return;
      }

      // Only broadcast if still running (i.e., not already completed)
      if (global.cacheGenerationStatus.isRunning === true) {
        global.cacheGenerationStatus.isRunning = false;
        global.cacheGenerationStatus.endTime = new Date();

        // If not already marked as error or success, mark based on exit code
        if (global.cacheGenerationStatus.success === null) {
          global.cacheGenerationStatus.success = code === 0;
          if (code !== 0) {
            global.cacheGenerationStatus.error = `Worker exited with code ${code}`;
          }
        }

        if (global.broadcastCacheGenerationUpdate) {
          console.error('[CACHE] Broadcasting exit status, code:', code);
          global.broadcastCacheGenerationUpdate({
            type: 'status',
            payload: global.cacheGenerationStatus,
          });
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Cache generation started. Connect to WebSocket for live updates.',
    });
  } catch (error) {
    console.error('Generate cache error:', error);
    global.cacheGenerationStatus.isRunning = false;
    global.cacheGenerationStatus.success = false;
    global.cacheGenerationStatus.error = error.message;
    global.cacheGenerationStatus.endTime = new Date();

    if (global.broadcastCacheGenerationUpdate) {
      global.broadcastCacheGenerationUpdate({
        type: 'status',
        payload: global.cacheGenerationStatus,
      });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    if (!global.cacheGenerationChild || !global.cacheGenerationStatus.isRunning) {
      return NextResponse.json({ error: 'No cache generation in progress' }, { status: 400 });
    }

    // Set flag to ignore further messages from the worker (except cancelled status)
    global.cacheGenerationCancelled = true;

    console.error('[CACHE] Sending cancel message to worker');

    // Send cancel message to worker to allow graceful shutdown
    try {
      global.cacheGenerationChild.send({ type: 'cancel' });
    } catch (err) {
      console.error('[CACHE] Failed to send cancel message:', err.message);
      // Fall back to killing the process if send fails
      global.cacheGenerationChild.kill('SIGTERM');
    }

    // Wait a bit for the worker to respond, then kill if necessary
    const killTimeout = setTimeout(() => {
      if (global.cacheGenerationChild) {
        console.error('[CACHE] Force killing worker process');
        global.cacheGenerationChild.kill('SIGKILL');
      }
    }, 5000);

    return NextResponse.json({ success: true, message: 'Cache generation cancellation requested' });
  } catch (error) {
    console.error('Stop cache generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
