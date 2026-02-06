/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { resolve, join } from 'node:path';
import fsPromises from 'fs/promises';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './.thumbnails';
const OPTI_CACHE_DIR = process.env.OPTI_CACHE_DIR || './opti-cache';
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || './.stream-cache';
const HEIC_JPEG_CACHE_DIR = process.env.HEIC_JPEG_CACHE_DIR || './.heic-jpeg-cache';

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

    // Spawn child process for generation (spawn avoids Turbopack resolving the worker path)
    const { spawn } = await import('child_process');
    const workerPath = join(process.cwd(), 'lib', 'workers', 'generateCacheWorker.mjs');
    const child = spawn(process.execPath, [workerPath], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    // Send config to child process
    child.send({
      scanDir,
      targetPath,
      type,
      thumbnailDir: THUMBNAIL_DIR,
      optiCacheDir: OPTI_CACHE_DIR,
      streamCacheDir: STREAM_CACHE_DIR,
      heicCacheDir: HEIC_JPEG_CACHE_DIR,
      cwd: process.cwd(),
    });

    // Create SSE stream that relays child process messages
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        child.on('message', (data) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream already closed
          }
        });

        child.on('error', (err) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`)
            );
            controller.close();
          } catch {
            // Stream already closed
          }
        });

        child.on('exit', (code) => {
          try {
            if (code !== 0 && code !== null) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ status: 'error', message: `Worker exited with code ${code}` })}\n\n`
                )
              );
            }
            controller.close();
          } catch {
            // Stream already closed
          }
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Generate cache error:', error);
    return NextResponse.json({ error: 'Failed to generate cache' }, { status: 500 });
  }
}
