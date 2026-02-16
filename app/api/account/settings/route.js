/** @format */

import { NextResponse } from 'next/server';
import { requireAuth, requireAuthNoActivity } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import bcryptjs from 'bcryptjs';

/**
 * GET /api/account/settings
 * Returns user's session lock settings (doesn't reset activity timer)
 */
export async function GET(req) {
  const { session, error } = await requireAuthNoActivity();
  if (error) return error;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        sessionLockEnabled: true,
        sessionLockTimeout: true,
        lastActivityAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      sessionLockEnabled: user.sessionLockEnabled,
      sessionLockTimeout: user.sessionLockTimeout,
      lastActivityAt: user.lastActivityAt,
    });
  } catch (error) {
    console.error('Error fetching session lock settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/account/settings
 * Update session lock settings (enable/disable, timeout, PIN)
 */
export async function PUT(req) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await req.json();
    const { sessionLockEnabled, sessionLockTimeout, sessionLockPin } = body;

    const updateData = {};

    if (typeof sessionLockEnabled === 'boolean') {
      updateData.sessionLockEnabled = sessionLockEnabled;
    }

    if (typeof sessionLockTimeout === 'number' && sessionLockTimeout > 0) {
      updateData.sessionLockTimeout = sessionLockTimeout;
    }

    if (typeof sessionLockPin === 'string' && sessionLockPin.length === 4 && /^\d+$/.test(sessionLockPin)) {
      const hashedPin = await bcryptjs.hash(sessionLockPin, 10);
      updateData.sessionLockPin = hashedPin;
    } else if (sessionLockPin === null) {
      updateData.sessionLockPin = null;
    } else if (sessionLockPin !== undefined) {
      return NextResponse.json(
        { error: 'PIN must be a 4-digit number' },
        { status: 400 }
      );
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields provided' },
        { status: 400 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        sessionLockEnabled: true,
        sessionLockTimeout: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error updating session lock settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
