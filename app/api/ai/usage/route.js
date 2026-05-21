/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { getUsageSnapshot } from '@/lib/ai/usage';

export async function GET() {
  const { session, error } = await requireAuthNoActivity();
  if (error) return error;
  const snapshot = await getUsageSnapshot(session.user.id);
  return NextResponse.json(snapshot);
}
