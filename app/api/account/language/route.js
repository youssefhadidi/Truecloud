/** @format */

import { NextResponse } from 'next/server';
import { requireAuthAllowLocked } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { clearLockStatusCache } from '@/lib/authOptions';
import { isLocale } from '@/lib/i18n/config';

/**
 * PUT /api/account/language
 * Update the user's UI language preference. Allowed even when the session is
 * locked (it's a harmless display preference), and intentionally separate from
 * /api/account/settings so it isn't gated behind the session-lock PIN.
 */
export async function PUT(req) {
  const { session, error } = await requireAuthAllowLocked();
  if (error) return error;

  try {
    const { language } = await req.json();
    if (!isLocale(language)) {
      return NextResponse.json({ error: 'Unsupported language' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { language },
    });

    // language is served from the cached lock-settings block in the session
    // callback, so bust that cache to reflect the change on the next session.
    clearLockStatusCache(session.user.id);

    return NextResponse.json({ language });
  } catch (err) {
    console.error('Error updating language:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
