/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { setBlocking, getBlocking } from '@/lib/pihole';
import { piholeError, readJson } from '../respond';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    return NextResponse.json(await getBlocking());
  } catch (e) {
    return piholeError(e, 'Failed to read blocking status');
  }
}

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  const timer = body.timer === null || body.timer === undefined ? null : Number(body.timer);
  if (timer !== null && (!Number.isInteger(timer) || timer < 1 || timer > 86400)) {
    return NextResponse.json({ error: 'Timer must be a whole number of seconds between 1 and 86400.' }, { status: 400 });
  }

  try {
    const result = await setBlocking(Boolean(body.enabled), timer);
    return NextResponse.json(result);
  } catch (e) {
    return piholeError(e, 'Failed to change blocking state');
  }
}
