/** @format */

import { NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import { requireAdmin } from '@/lib/authCheck';
import { APK_PATH } from '@/lib/truecloudSync';

// GET - Report whether the Android APK is available for download
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const stats = await stat(APK_PATH);
    if (!stats.isFile()) throw new Error('not a file');
    return NextResponse.json({ apk: { available: true, size: stats.size, updatedAt: stats.mtime.toISOString() } });
  } catch {
    return NextResponse.json({ apk: { available: false } });
  }
}
