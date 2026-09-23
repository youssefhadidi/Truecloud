/** @format */

import { NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import { requireAdmin } from '@/lib/authCheck';
import { APK_PATH, APK_FALLBACK_URL } from '@/lib/truecloudSync';

// GET - Report whether the Android APK is available locally, plus the EAS
// fallback link the page uses when it isn't
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const stats = await stat(APK_PATH);
    if (!stats.isFile()) throw new Error('not a file');
    return NextResponse.json({
      apk: { available: true, size: stats.size, updatedAt: stats.mtime.toISOString(), fallbackUrl: APK_FALLBACK_URL },
    });
  } catch {
    return NextResponse.json({ apk: { available: false, fallbackUrl: APK_FALLBACK_URL } });
  }
}
