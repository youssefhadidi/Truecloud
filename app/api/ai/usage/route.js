/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { getUsageSnapshot } from '@/lib/ai/usage';

export async function GET() {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;
    const snapshot = await getUsageSnapshot(session.user.id);
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error('[GET /api/ai/usage] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error', kind: err?.name || 'Error' },
      { status: 500 },
    );
  }
}
