/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';

/**
 * Checks if a user is authenticated and returns consistent error response
 * Returns 403 (Forbidden) for invalid/expired sessions to trigger frontend logout
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
