/** @format */

import { NextResponse } from 'next/server';
import { requireAuthAllowLocked } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { clearLockStatusCache } from '@/lib/authOptions';
import bcryptjs from 'bcryptjs';

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
      select: { sessionLockPin: true, sessionLockEnabled: true },
    });

    if (!user || !user.sessionLockEnabled || !user.sessionLockPin) {
      return NextResponse.json(
        { error: 'Session lock not configured' },
        { status: 400 }
      );
    }

    const isValid = await bcryptjs.compare(pin, user.sessionLockPin);

    if (!isValid) {
      return NextResponse.json(
        { success: false },
        { status: 200 }
      );
    }

    // PIN is correct - clear lock and reset activity timer
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        isSessionLocked: false,
        lastActivityAt: new Date(),
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
