/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getDomains, addDomain, deleteDomain } from '@/lib/pihole';
import { piholeError, readJson } from '../respond';

export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const params = new URL(req.url).searchParams;

  try {
    return NextResponse.json(await getDomains(params.get('type') || 'deny', params.get('kind') || 'exact'));
  } catch (e) {
    return piholeError(e, 'Failed to load domains');
  }
}

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  try {
    const result = await addDomain(body.domain, {
      type: body.type || 'deny',
      kind: body.kind || 'exact',
      comment: body.comment ?? '',
      enabled: body.enabled ?? true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return piholeError(e, 'Failed to add the domain');
  }
}

export async function DELETE(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const domain = params.get('domain');
  if (!domain) {
    return NextResponse.json({ error: 'Missing "domain" parameter' }, { status: 400 });
  }

  try {
    await deleteDomain(domain, params.get('type') || 'deny', params.get('kind') || 'exact');
    return NextResponse.json({ success: true });
  } catch (e) {
    return piholeError(e, 'Failed to remove the domain');
  }
}
