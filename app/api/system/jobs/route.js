/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { listJobs } from '@/lib/jobManager';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  return NextResponse.json({ jobs: listJobs() });
}
