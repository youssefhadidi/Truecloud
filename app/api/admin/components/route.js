/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { readComponentsConfig, writeComponentsConfig } from '@/lib/componentsConfig';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const config = await readComponentsConfig();
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json({ error: 'Failed to read components config' }, { status: 500 });
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const config = await writeComponentsConfig(body);
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json({ error: 'Failed to save components config' }, { status: 500 });
  }
}
