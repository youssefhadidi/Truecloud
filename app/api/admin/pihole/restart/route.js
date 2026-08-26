/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { restartDns } from '@/lib/pihole';
import { piholeError } from '../respond';

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    await restartDns();
    return NextResponse.json({ success: true });
  } catch (e) {
    return piholeError(e, 'Failed to restart the DNS resolver');
  }
}
