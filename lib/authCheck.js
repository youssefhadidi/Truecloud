/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// In-memory per-user throttle for lastActivityAt writes. Sessions lock on the
// minute timescale, so coalescing many bursty API calls into one DB write
// every few seconds is safe and substantially reduces write load on SQLite.
const activityWriteAt = new Map(); // userId -> epoch ms of last write
const ACTIVITY_WRITE_INTERVAL_MS = 5_000;

export function bumpLastActivity(userId) {
  const now = Date.now();
  const last = activityWriteAt.get(userId) || 0;
  if (now - last < ACTIVITY_WRITE_INTERVAL_MS) return;
  activityWriteAt.set(userId, now);
  prisma.user
    .update({ where: { id: userId }, data: { lastActivityAt: new Date(now) } })
    .catch(() => {
      // Roll back the throttle stamp on failure so the next call retries.
      activityWriteAt.delete(userId);
    });
}

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

  // Check lock status from JWT (computed in session callback every 30s)
  if (session.user.isLocked) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Session is locked' },
        { status: 423 }
      ),
    };
  }

  // Update lastActivityAt for session lock (throttled, fire-and-forget)
  bumpLastActivity(session.user.id);

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

  // Check lock status from JWT (computed in session callback every 30s)
  if (session.user.isLocked) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Session is locked' },
        { status: 423 }
      ),
    };
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
