/** @format */

import { NextResponse } from 'next/server';
import { requireAuthAllowLocked } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/account/lock
 * Manually lock the current session
 */
export async function POST(request) {
  const { session, error } = await requireAuthAllowLocked();

  if (error) return error;

  try {
    // Set isSessionLocked to true in DB
    await prisma.user.update({
      where: { id: session.user.id },
      data: { isSessionLocked: true },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error locking session:', err);
    return NextResponse.json({ error: 'Failed to lock session' }, { status: 500 });
  }
}
