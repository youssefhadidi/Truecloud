/** @format */

import { NextResponse } from 'next/server';
import { requireAuthAllowLocked } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { clearLockStatusCache } from '@/lib/authOptions';
import bcryptjs from 'bcryptjs';

// After this many consecutive failures, start blocking PIN entry with
// exponentially growing delays. 4-digit PIN is small keyspace, so we cap
// throughput aggressively.
const FAILURE_GRACE = 3;
const BASE_LOCKOUT_MS = 30 * 1000; // 30s after the 4th failure
const MAX_LOCKOUT_MS = 60 * 60 * 1000; // cap at 1 hour

function computeLockoutMs(failures) {
  if (failures <= FAILURE_GRACE) return 0;
  const exponent = failures - FAILURE_GRACE - 1;
  const ms = BASE_LOCKOUT_MS * Math.pow(2, exponent);
  return Math.min(ms, MAX_LOCKOUT_MS);
}

/**
 * POST /api/account/verify-pin
 * Verify the 4-digit session lock PIN
 * On success, clears the lock and resets lastActivityAt
 * (uses allowLocked variant so locked users can still verify PIN)
 */
export async function POST(req) {
  const { session, error } = await requireAuthAllowLocked();
  if (error) return error;

  try {
    const body = await req.json();
    const { pin } = body;

    if (!pin || typeof pin !== 'string' || pin.length !== 4 || !/^\d+$/.test(pin)) {
      return NextResponse.json(
        { error: 'Invalid PIN format' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        sessionLockPin: true,
        sessionLockEnabled: true,
        pinFailures: true,
        pinLockedUntil: true,
      },
    });

    if (!user || !user.sessionLockEnabled || !user.sessionLockPin) {
      return NextResponse.json(
        { error: 'Session lock not configured' },
        { status: 400 }
      );
    }

    // Enforce any existing lockout window before doing any bcrypt work.
    const now = Date.now();
    if (user.pinLockedUntil && new Date(user.pinLockedUntil).getTime() > now) {
      const retryAfterSec = Math.ceil((new Date(user.pinLockedUntil).getTime() - now) / 1000);
      return NextResponse.json(
        { success: false, lockedOut: true, retryAfter: retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
      );
    }

    const isValid = await bcryptjs.compare(pin, user.sessionLockPin);

    if (!isValid) {
      const failures = (user.pinFailures || 0) + 1;
      const lockoutMs = computeLockoutMs(failures);
      const lockedUntil = lockoutMs > 0 ? new Date(now + lockoutMs) : null;

      await prisma.user.update({
        where: { id: session.user.id },
        data: { pinFailures: failures, pinLockedUntil: lockedUntil },
      });

      if (lockoutMs > 0) {
        const retryAfterSec = Math.ceil(lockoutMs / 1000);
        return NextResponse.json(
          { success: false, lockedOut: true, retryAfter: retryAfterSec },
          { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
        );
      }
      return NextResponse.json({ success: false }, { status: 200 });
    }

    // PIN is correct - clear lock and reset activity timer + failure counter
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        isSessionLocked: false,
        lastActivityAt: new Date(),
        pinFailures: 0,
        pinLockedUntil: null,
      },
    });

    // Clear the lock status cache so next session fetch gets fresh data
    clearLockStatusCache(session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error verifying PIN:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
