/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// GET - Get share details
export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const share = await prisma.share.findUnique({
      where: { id },
    });

    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // Only owner can view share details
    if (share.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ share });
  } catch (error) {
    console.error('GET /api/shares/[id] - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update share (password, expiration)
export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { password, removePassword, expiresAt } = await req.json();

    const share = await prisma.share.findUnique({
      where: { id },
    });

    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // Only owner can update share
    if (share.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData = {};

    // Update password
    if (removePassword) {
      updateData.passwordHash = null;
    } else if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    // Update expiration
    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    const updatedShare = await prisma.share.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ share: updatedShare });
  } catch (error) {
    console.error('PATCH /api/shares/[id] - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Revoke share
export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const share = await prisma.share.findUnique({
      where: { id },
    });

    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // Only owner can delete share
    if (share.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await prisma.share.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/shares/[id] - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
