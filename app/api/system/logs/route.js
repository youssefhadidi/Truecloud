/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createReadStream } from 'fs';

export async function GET(req) {
  try {
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    const lines = parseInt(url.searchParams.get('lines') || '100', 10);

    // Try common log locations
    const logPaths = [
      '/var/log/truecloud/output.log',
      resolve(process.cwd(), '.next/logs/server.log'),
      resolve(process.cwd(), 'logs/app.log'),
      resolve(process.cwd(), 'app.log'),
    ];

    let logPath = null;
    let logContent = '';

    // Find which log file exists and read it
    for (const path of logPaths) {
      try {
        logContent = await readFile(path, 'utf-8');
        logPath = path;
        break;
      } catch {
        continue;
      }
    }

    if (!logPath) {
      return NextResponse.json({
        error: 'No log file found',
        paths: logPaths,
      }, { status: 404 });
    }

    // Get last N lines
    const logLines = logContent
      .split('\n')
      .filter(line => line.trim())
      .slice(-lines);

    return NextResponse.json({
      success: true,
      logPath,
      lines: logLines,
      total: logLines.length,
    });
  } catch (error) {
    return NextResponse.json({
      error: error.message,
    }, { status: 500 });
  }
}
