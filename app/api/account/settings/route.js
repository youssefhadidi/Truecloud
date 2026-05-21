/** @format */

import { NextResponse } from 'next/server';
import { requireAuthAllowLocked } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { clearLockStatusCache } from '@/lib/authOptions';
import bcryptjs from 'bcryptjs';

const MAX_TIMEOUT_MINUTES = 24 * 60; // 24 hours

/**
 * GET /api/account/settings
 * Returns user's session lock settings (doesn't reset activity timer)
 * Allowed even when session is locked
 */
export async function GET(req) {
  const { session, error } = await requireAuthAllowLocked();
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
 *
 * Security: when the lock is already configured (sessionLockEnabled === true
 * AND sessionLockPin is set), the caller must supply `currentPin` in the body
 * and we verify it before applying any change. This prevents an attacker with
 * an authenticated cookie (e.g. via devtools on a locked tab) from disabling
 * the lock or overwriting the PIN.
 */
export async function PUT(req) {
  const { session, error } = await requireAuthAllowLocked();
  if (error) return error;

  try {
    const body = await req.json();
    const { sessionLockEnabled, sessionLockTimeout, sessionLockPin, currentPin } = body;

    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { sessionLockEnabled: true, sessionLockPin: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const lockIsConfigured = existing.sessionLockEnabled && !!existing.sessionLockPin;
    if (lockIsConfigured) {
      if (typeof currentPin !== 'string' || currentPin.length !== 4 || !/^\d+$/.test(currentPin)) {
        return NextResponse.json(
          { error: 'Current PIN is required to change lock settings' },
          { status: 400 }
        );
      }
      const ok = await bcryptjs.compare(currentPin, existing.sessionLockPin);
      if (!ok) {
        return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 });
      }
    }

    const updateData = {};

    if (typeof sessionLockEnabled === 'boolean') {
      updateData.sessionLockEnabled = sessionLockEnabled;
    }

    if (typeof sessionLockTimeout === 'number' && Number.isFinite(sessionLockTimeout)) {
      if (sessionLockTimeout <= 0 || sessionLockTimeout > MAX_TIMEOUT_MINUTES) {
        return NextResponse.json(
          { error: `Timeout must be between 1 and ${MAX_TIMEOUT_MINUTES} minutes` },
          { status: 400 }
        );
      }
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

    // Reset activity timer when settings are updated
    updateData.lastActivityAt = new Date();

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        sessionLockEnabled: true,
        sessionLockTimeout: true,
      },
    });

    // Clear the lock status cache so next session fetch gets fresh data
    clearLockStatusCache(session.user.id);

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error updating session lock settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
