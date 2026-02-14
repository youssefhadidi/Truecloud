/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readFile, writeFile, appendFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const STATE_FILE = resolve(process.cwd(), '.logs-state.json');
const HISTORY_FILE = resolve(process.cwd(), '.logs-history.json');
const HISTORY_LIMIT = 50; // Keep only last 50 lines

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
    // Keep only the last 50 lines (like tail -50)
    if (history.lines.length > HISTORY_LIMIT) {
      history.lines = history.lines.slice(-HISTORY_LIMIT);
    }
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

    // Just return current history (logStreamManager handles reading the actual log file)
    const history = await getLogHistory();

    return NextResponse.json({
      success: true,
      allLines: history.lines,
      total: history.lines.length,
    });
  } catch (error) {
    return NextResponse.json({
      error: error.message,
    }, { status: 500 });
  }
}
