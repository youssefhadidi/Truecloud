/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { mkdir, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        hasRootAccess: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create new user (admin only)
export async function POST(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { email, username, password, name, role, hasRootAccess } = await req.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        name: name || username,
        role: role || 'user',
        // Admins always have root access
        hasRootAccess: role === 'admin' ? true : hasRootAccess || false,
      },
    });

    // Create private directory for regular users
    if (user.role !== 'admin') {
      const userDir = join(UPLOAD_DIR, `user_${user.id}`);
      if (!existsSync(userDir)) {
        await mkdir(userDir, { recursive: true });
      }
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role,
          hasRootAccess: user.hasRootAccess,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete user (admin only)
export async function DELETE(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Prevent deletion of admin users
    const userToDelete = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userToDelete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (userToDelete.role === 'admin') {
      return NextResponse.json({ error: 'Cannot delete admin users' }, { status: 403 });
    }

    // Delete user from database
    await prisma.user.delete({
      where: { id: userId },
    });

    // Delete user's personal folder if it exists
    const userDir = join(UPLOAD_DIR, `user_${userId}`);
    if (existsSync(userDir)) {
      try {
        // Recursively remove the directory
        await rmdir(userDir, { recursive: true, force: true });
      } catch (folderError) {
        console.error('Error deleting user folder:', folderError);
        // Don't fail the user deletion if folder deletion fails
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update user (admin only)
export async function PATCH(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { id, email, username, name, password, role, hasRootAccess } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const updateData = {};
    if (email) updateData.email = email;
    if (username) updateData.username = username;
    if (name) updateData.name = name;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (role) updateData.role = role;

    // Handle hasRootAccess: admins always have it, others only if explicitly set
    if (role === 'admin') {
      updateData.hasRootAccess = true;
    } else if (typeof hasRootAccess === 'boolean') {
      updateData.hasRootAccess = hasRootAccess;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        hasRootAccess: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
