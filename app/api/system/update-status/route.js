/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { getStatus } from '@/lib/updateStatus';

export async function GET(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    const status = getStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
