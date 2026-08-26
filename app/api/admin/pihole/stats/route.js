/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getSummary, getTopDomains, getTopClients, getUpstreams, getQueryTypes } from '@/lib/pihole';
import { piholeError } from '../respond';

export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const countParam = Number(new URL(req.url).searchParams.get('count'));
  const count = Number.isFinite(countParam) ? Math.min(Math.max(countParam, 1), 50) : 10;

  try {
    const [summary, topBlocked, topPermitted, topClients, upstreams, queryTypes] = await Promise.all([
      getSummary(),
      getTopDomains(true, count),
      getTopDomains(false, count),
      getTopClients(false, count),
      getUpstreams(),
      getQueryTypes(),
    ]);

    return NextResponse.json({ summary, topBlocked, topPermitted, topClients, upstreams, queryTypes });
  } catch (e) {
    return piholeError(e, 'Failed to load Pi-hole statistics');
  }
}
