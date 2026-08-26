/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getQueries } from '@/lib/pihole';
import { piholeError } from '../respond';

export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const params = new URL(req.url).searchParams;

  try {
    const result = await getQueries({
      length: params.get('length') ?? 100,
      cursor: params.get('cursor') ?? undefined,
      domain: params.get('domain') ?? undefined,
      client: params.get('client') ?? undefined,
      upstream: params.get('upstream') ?? undefined,
      type: params.get('type') ?? undefined,
      status: params.get('status') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return piholeError(e, 'Failed to load the query log');
  }
}
