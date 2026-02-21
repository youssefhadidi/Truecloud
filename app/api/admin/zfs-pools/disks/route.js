/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { listAvailableDisks } from '@/lib/zfs';

export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const disks = await listAvailableDisks();

    return NextResponse.json({ disks });
  } catch (error) {
    console.error('Error fetching available disks:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch available disks' },
      { status: 500 }
    );
  }
}
