/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

/**
 * Checks if a user is authenticated and returns consistent error response
 * Returns 403 (Forbidden) for invalid/expired sessions to trigger frontend logout
 * Returns 423 (Locked) if session is locked
 * Also updates lastActivityAt for session lock feature (fire-and-forget)
 *
 * @returns {Promise<{session: Object|null, error: NextResponse|null}>}
 */
export async function requireAuth() {
  const session = await auth();

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 403 }
      ),
    };
  }

  // Check current lock status from DB (not just cached session)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sessionLockEnabled: true, sessionLockTimeout: true, lastActivityAt: true, isSessionLocked: true }
  });

  if (user) {
    const inactivityExpired = user.sessionLockEnabled &&
      (Date.now() - new Date(user.lastActivityAt).getTime() > user.sessionLockTimeout * 60 * 1000);
    const isLocked = user.isSessionLocked || inactivityExpired;

    if (isLocked) {
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Session is locked' },
          { status: 423 }
        ),
      };
    }
  }

  // Update lastActivityAt for session lock (fire-and-forget, no await)
  prisma.user
    .update({ where: { id: session.user.id }, data: { lastActivityAt: new Date() } })
    .catch(() => {});

  return {
    session,
    error: null,
  };
}

/**
 * Like requireAuth but doesn't update lastActivityAt
 * Used for read-only endpoints that shouldn't reset the inactivity timer
 * Still blocks locked sessions
 *
 * @returns {Promise<{session: Object|null, error: NextResponse|null}>}
 */
export async function requireAuthNoActivity() {
  const session = await auth();

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 403 }
      ),
    };
  }

  // Check current lock status from DB (not just cached session)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sessionLockEnabled: true, sessionLockTimeout: true, lastActivityAt: true, isSessionLocked: true }
  });

  if (user) {
    const inactivityExpired = user.sessionLockEnabled &&
      (Date.now() - new Date(user.lastActivityAt).getTime() > user.sessionLockTimeout * 60 * 1000);
    const isLocked = user.isSessionLocked || inactivityExpired;

    if (isLocked) {
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Session is locked' },
          { status: 423 }
        ),
      };
    }
  }

  return {
    session,
    error: null,
  };
}

/**
 * Like requireAuth but allows locked sessions
 * Used for endpoints that must remain accessible when locked (verify-pin, lock, settings)
 * Does not update lastActivityAt
 *
 * @returns {Promise<{session: Object|null, error: NextResponse|null}>}
 */
export async function requireAuthAllowLocked() {
  const session = await auth();

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 403 }
      ),
    };
  }

  return {
    session,
    error: null,
  };
}

/**
 * Checks if authenticated user is an admin
 * Returns 403 if not authenticated or not an admin
 *
 * @returns {Promise<{session: Object|null, error: NextResponse|null}>}
 */
export async function requireAdmin() {
  const { session, error } = await requireAuth();

  if (error) {
    return { session: null, error };
  }

  if (session.user.role !== 'admin') {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      ),
    };
  }

  return {
    session,
    error: null,
  };
}
