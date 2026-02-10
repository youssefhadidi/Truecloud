/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { readThumbnailConfig, writeThumbnailConfig, getThumbnailConfigPath } from '@/lib/thumbnailConfig';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const config = await readThumbnailConfig();
    return NextResponse.json({ config, path: getThumbnailConfigPath() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read thumbnail settings' }, { status: 500 });
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const config = await writeThumbnailConfig(body);
    return NextResponse.json({ config, path: getThumbnailConfigPath() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save thumbnail settings' }, { status: 500 });
  }
}
