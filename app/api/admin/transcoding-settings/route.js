/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import {
  readTranscodingConfig,
  writeTranscodingConfig,
  getTranscodingConfigPath,
} from '@/lib/transcodingConfig';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const config = await readTranscodingConfig();
    return NextResponse.json({ config, path: getTranscodingConfigPath() });
  } catch {
    return NextResponse.json({ error: 'Failed to read transcoding settings' }, { status: 500 });
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const config = await writeTranscodingConfig(body);
    return NextResponse.json({ config, path: getTranscodingConfigPath() });
  } catch {
    return NextResponse.json({ error: 'Failed to save transcoding settings' }, { status: 500 });
  }
}
