/** @format */

import { NextResponse } from 'next/server';
import { requireAuth, bumpLastActivity } from '@/lib/authCheck';

/**
 * POST /api/account/heartbeat
 * Records that the user is actively present, resetting the inactivity timer.
 * Called by the frontend when it detects real input (mouse / keyboard / touch)
 * and we haven't recently called any other API. requireAuth already bumps
 * lastActivityAt, so calling it again here is a no-op when throttled - the
 * value of this endpoint is being a dedicated, cheap activity ping.
 */
export async function POST() {
  const { session, error } = await requireAuth();
  if (error) return error;
  // requireAuth already bumped activity; explicit bump is defense-in-depth.
  bumpLastActivity(session.user.id);
  return NextResponse.json({ ok: true });
}
