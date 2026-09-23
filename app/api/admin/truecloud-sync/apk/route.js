/** @format */

import { NextResponse } from 'next/server';
import fs from 'fs';
import { stat } from 'fs/promises';
import { requireAdmin } from '@/lib/authCheck';
import { nodeToWebStream } from '@/lib/streamUtils';
import { APK_PATH, APK_FILENAME, APK_FALLBACK_URL } from '@/lib/truecloudSync';

// GET - Download the Truecloud Sync Android APK, falling back to the EAS
// build artifact when no local copy is present
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  let stats;
  try {
    stats = await stat(APK_PATH);
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    return NextResponse.redirect(APK_FALLBACK_URL, 302);
  }

  return new NextResponse(nodeToWebStream(fs.createReadStream(APK_PATH)), {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stats.size.toString(),
      'Content-Disposition': `attachment; filename="${APK_FILENAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
