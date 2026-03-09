/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { listPools, createPool } from '@/lib/zfs';

export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const pools = await listPools();

    return NextResponse.json({ pools });
  } catch (error) {
    console.error('Error fetching ZFS pools:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { name, vdevType, devices, force = false } = await req.json();

    // Validation
    if (!name) {
      return NextResponse.json({ error: 'Pool name is required' }, { status: 400 });
    }

    // Pool name validation: alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json(
        { error: 'Pool name can only contain letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    if (!vdevType) {
      return NextResponse.json({ error: 'vdevType is required' }, { status: 400 });
    }

    if (!Array.isArray(devices) || devices.length === 0) {
      return NextResponse.json(
        { error: 'At least one device is required' },
        { status: 400 }
      );
    }

    // Validate vdevType
    if (!['stripe', 'mirror', 'raidz', 'raidz2'].includes(vdevType)) {
      return NextResponse.json(
        { error: 'Invalid vdevType. Must be: stripe, mirror, raidz, or raidz2' },
        { status: 400 }
      );
    }

    // Create the pool
    await createPool(name, vdevType, devices, force);

    return NextResponse.json(
      { success: true, message: `ZFS pool '${name}' created successfully` },
      { status: 201 }
    );
  } catch (error) {
    if (error.code === 'EXISTING_FILESYSTEM') {
      return NextResponse.json(
        { error: error.message, code: 'EXISTING_FILESYSTEM', details: error.details },
        { status: 409 }
      );
    }
    console.error('Error creating ZFS pool:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create ZFS pool' },
      { status: 500 }
    );
  }
}
