/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { addCacheDevice } from '@/lib/zfs';

export async function POST(req, { params }) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { name } = await params;

    if (!name) {
      return NextResponse.json({ error: 'Pool name is required' }, { status: 400 });
    }

    const { device } = await req.json();

    if (!device) {
      return NextResponse.json({ error: 'device is required' }, { status: 400 });
    }

    await addCacheDevice(name, device);

    return NextResponse.json({ success: true, message: `Cache device '${device}' added to pool '${name}'` });
  } catch (error) {
    console.error('Error adding cache device:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add cache device' },
      { status: 500 }
    );
  }
}
