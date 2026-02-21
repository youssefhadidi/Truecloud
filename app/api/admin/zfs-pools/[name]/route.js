/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getPoolStatus, listDatasets } from '@/lib/zfs';

export async function GET(req, { params }) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { name } = params;

    if (!name) {
      return NextResponse.json({ error: 'Pool name is required' }, { status: 400 });
    }

    // Get pool status and datasets in parallel
    const [status, datasets] = await Promise.all([
      getPoolStatus(name),
      listDatasets(name),
    ]);

    return NextResponse.json({ status, datasets });
  } catch (error) {
    console.error(`Error fetching ZFS pool details for ${params.name}:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pool details' },
      { status: 500 }
    );
  }
}
