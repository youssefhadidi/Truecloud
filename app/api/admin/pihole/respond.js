/** @format */

import { NextResponse } from 'next/server';
import { PiholeError } from '@/lib/pihole';

/**
 * Turn a thrown error into a response, preserving the upstream status so the
 * UI can distinguish "bad input" (400) from "wrong password" (401) from
 * "Pi-hole is unreachable" (502).
 */
export function piholeError(e, fallback = 'Pi-hole request failed') {
  const status = e instanceof PiholeError ? e.status : 500;
  return NextResponse.json({ error: e?.message || fallback, hint: e?.hint ?? undefined }, { status });
}

/** Parse a JSON request body, returning `{ body }` or `{ response }`. */
export async function readJson(req) {
  try {
    return { body: await req.json() };
  } catch {
    return { response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}
