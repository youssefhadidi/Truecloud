/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { spawn } from 'child_process';
import { logger } from '@/lib/logger';

export async function POST(req) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      logger.warn('POST /api/system/run-update - Unauthorized access');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional: Check if user is admin (if your app has admin roles)
    // For now, just logging the action
    logger.info('Update requested', { userId: session.user.id, email: session.user.email });

    // Run pnpm runUpdate in background
    const updateProcess = spawn('pnpm', ['runUpdate'], {
      detached: true,
      stdio: 'ignore', // Ignore stdin, stdout, stderr
      cwd: process.cwd(),
    });

    // Unref the process so the Node process can exit even if the child is still running
    updateProcess.unref();

    // Log the process ID for monitoring
    logger.info('Update process started', { pid: updateProcess.pid });

    return NextResponse.json({
      success: true,
      message: 'Update process started. The server will restart automatically.',
      pid: updateProcess.pid,
    });
  } catch (error) {
    logger.error('POST /api/system/run-update - Error', { error: error.message });
    return NextResponse.json({ 
      success: false, 
      error: error.message,
    }, { status: 500 });
  }
}
