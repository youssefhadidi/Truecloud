/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getAllLockedPaths } from '@/lib/folderLocks';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const paths = await getAllLockedPaths();
  return NextResponse.json({ paths });
}
