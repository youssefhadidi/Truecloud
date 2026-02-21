/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import bcryptjs from 'bcryptjs';
import { addOrUpdateSmbUser } from '@/lib/samba';

/**
 * PUT /api/account/password
 * Change the current user's password.
 * Requires current password for verification.
 */
export async function PUT(req) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, username: true, password: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isValid = await bcryptjs.compare(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    const hashedPassword = await bcryptjs.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword },
    });

    // Sync new password to Samba (best-effort)
    try {
      await addOrUpdateSmbUser(user.username, newPassword);
    } catch (sambaError) {
      console.error('Warning: Failed to update Samba password:', sambaError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
