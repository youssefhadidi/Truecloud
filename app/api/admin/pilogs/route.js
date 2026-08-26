/** @format */

/**
 * Per-client DNS category report.
 *
 * Deliberately not linked from the admin navigation, but obscurity is not the
 * access control — requireAdmin is. The URL leaks through browser history,
 * bookmarks, and proxy logs, so the gate has to hold on its own.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getClientCategoryReport } from '@/lib/piholeDnsReport';
import { piholeError } from '../pihole/respond';

export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const hours = Number(params.get('hours'));
  const topDomains = Number(params.get('topDomains'));

  try {
    const report = await getClientCategoryReport({
      hours: Number.isFinite(hours) ? hours : 24,
      topDomains: Number.isFinite(topDomains) ? topDomains : 8,
    });
    return NextResponse.json(report);
  } catch (e) {
    return piholeError(e, 'Failed to build the DNS category report');
  }
}
