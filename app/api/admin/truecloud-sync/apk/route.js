/** @format */

import { NextResponse } from 'next/server';
import fs from 'fs';
import { stat } from 'fs/promises';
import { requireAdmin } from '@/lib/authCheck';
import { nodeToWebStream } from '@/lib/streamUtils';
import { APK_PATH, APK_FILENAME } from '@/lib/truecloudSync';

// GET - Download the Truecloud Sync Android APK
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  let stats;
  try {
    stats = await stat(APK_PATH);
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    return NextResponse.json({ error: 'APK not found' }, { status: 404 });
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
