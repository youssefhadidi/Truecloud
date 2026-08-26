/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { runGravity } from '@/lib/pihole';
import { createJob, startJob, addJobLog, setJobProgress, completeJob } from '@/lib/jobManager';
import { piholeError } from '../respond';

/**
 * A gravity rebuild downloads every configured blocklist and can run for
 * minutes, so it is handed to the job system and its progress streams to
 * Admin → Activity. The request returns as soon as the job is registered.
 */
export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  let jobId;
  try {
    jobId = createJob('Pi-hole gravity update', 'pihole-gravity');
  } catch (e) {
    return piholeError(e, 'Failed to start the gravity update');
  }

  startJob(jobId);
  addJobLog(jobId, 'Rebuilding gravity...');

  // Gravity reports no percentage, so creep the bar forward per line and let
  // completeJob snap it to 100.
  let lines = 0;

  runGravity((line) => {
    lines += 1;
    addJobLog(jobId, line);
    setJobProgress(jobId, Math.min(95, Math.round((lines / 40) * 95)));
  })
    .then(() => {
      addJobLog(jobId, 'Gravity update complete.');
      completeJob(jobId, true);
    })
    .catch((e) => {
      addJobLog(jobId, e.message, 'error');
      completeJob(jobId, false, e.message);
    });

  return NextResponse.json({ jobId }, { status: 202 });
}
