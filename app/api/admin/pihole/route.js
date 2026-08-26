/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { readPiholeConfig, writePiholeConfig } from '@/lib/piholeConfig';
import { getStatus, validateBaseUrl, invalidatePiholeSession, PiholeError } from '@/lib/pihole';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    return NextResponse.json(await getStatus());
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to read Pi-hole status' }, { status: 500 });
  }
}

/**
 * Save the connection settings, then report the resulting status so the UI can
 * show the outcome of a "Test connection" in one round trip.
 */
export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const current = await readPiholeConfig();
  const baseUrl = body.baseUrl === undefined ? current.baseUrl : String(body.baseUrl);

  try {
    validateBaseUrl(baseUrl);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 400 });
  }

  try {
    // An omitted or empty password keeps the stored one — the browser never
    // receives it, so it cannot send it back.
    const password = body.password ? String(body.password) : undefined;
    await writePiholeConfig({ baseUrl, password });
    // Settings changed: the cached SID may belong to a different host now.
    invalidatePiholeSession();

    return NextResponse.json(await getStatus());
  } catch (e) {
    const status = e instanceof PiholeError ? e.status : 500;
    return NextResponse.json({ error: e.message || 'Failed to save Pi-hole settings' }, { status });
  }
}
