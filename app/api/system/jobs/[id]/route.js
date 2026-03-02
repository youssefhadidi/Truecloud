/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { getJob, cancelJob } from '@/lib/jobManager';

export async function GET(req, { params }) {
  const { error } = await requireAuth();
  if (error) return error;

  const job = getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  return NextResponse.json({ job });
}

export async function DELETE(req, { params }) {
  const { error } = await requireAuth();
  if (error) return error;

  const cancelled = cancelJob(params.id);
  if (!cancelled) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  return NextResponse.json({ job: getJob(params.id) });
}
