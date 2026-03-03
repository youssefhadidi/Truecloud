/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { testTrackerConnectivity } from '@/lib/torrentProcess';
import { logger } from '@/lib/logger';

export async function POST(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    // Only admins can test trackers
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { trackerUrl } = await req.json();

    if (!trackerUrl) {
      return NextResponse.json({ error: 'trackerUrl required' }, { status: 400 });
    }

    logger.info('Testing tracker connectivity', { trackerUrl, user: session.user.email });

    const result = await testTrackerConnectivity(trackerUrl);

    return NextResponse.json({
      trackerUrl,
      ...result,
    });
  } catch (error) {
    logger.error('Tracker test error', { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
