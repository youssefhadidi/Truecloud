/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { getUsbDrives } from '@/lib/usbManager';

export async function GET() {
  const { error } = await requireAuthNoActivity();
  if (error) return error;
  return NextResponse.json({ drives: getUsbDrives() });
}
