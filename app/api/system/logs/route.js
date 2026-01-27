/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readFile, writeFile, appendFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const STATE_FILE = resolve(process.cwd(), '.logs-state.json');
const HISTORY_FILE = resolve(process.cwd(), '.logs-history.json');

async function getLogState() {
  try {
    if (existsSync(STATE_FILE)) {
      const content = await readFile(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return deefault state if file doesn't exist or is invalid
  }
  return { lastOffset: 0, lastPath: null };
}

async function saveLogState(path, offset) {
  try {
    await writeFile(STATE_FILE, JSON.stringify({ lastOffset: offset, lastPath: path }, null, 2));
  } catch (error) {
    console.error('Failed to save log state:', error);
  }
}

async function getLogHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = await readFile(HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty history if file doesn't exist or is invalid
  }
  return { lines: [] };
}

async function appendToHistory(newLines) {
  try {
    const history = await getLogHistory();
    history.lines.push(...newLines);
    await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Failed to append to history:', error);
  }
}

export async function GET(req) {
  try {
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return new NextResponse('Unauthorized', { status: 401 });
    }

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

    // Get stored state
    const state = await getLogState();
    const history = await getLogHistory();
    
    // If log path changed, reset offset
    let newLines = [];
    let newOffset = logContent.length;
    
    if (state.lastPath === logPath && state.lastOffset < logContent.length) {
      // Only get new content since last read
      const newContent = logContent.slice(state.lastOffset);
      newLines = newContent
        .split('\n')
        .filter(line => line.trim());
    } else if (state.lastPath !== logPath) {
      // Different log file, return all
      newLines = logContent
        .split('\n')
        .filter(line => line.trim());
    }

    // Append new lines to history
    if (newLines.length > 0) {
      await appendToHistory(newLines);
    }

    // Save new state
    await saveLogState(logPath, newOffset);

    return NextResponse.json({
      success: true,
      logPath,
      newLines,
      allLines: history.lines,
      total: history.lines.length,
      offset: newOffset,
    });
  } catch (error) {
    return NextResponse.json({
      error: error.message,
    }, { status: 500 });
  }
}
