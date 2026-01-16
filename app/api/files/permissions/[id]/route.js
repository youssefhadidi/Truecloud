/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkUserIsAdmin } from '@/lib/permissions';
import { serializeBigInt } from '@/lib/serialize';

// GET - Get permissions for a file
export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fileId = params.id;

    const file = await prisma.file.findUnique({
      where: { id: fileId },
      include: {
        permissions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ permissions: serializeBigInt(file.permissions) });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Add permission
export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fileId = params.id;
    const { userId, canRead, canWrite, canDelete, canShare } = await req.json();

    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const permission = await prisma.filePermission.upsert({
      where: {
        fileId_userId: {
          fileId,
          userId,
        },
      },
      update: {
        canRead: canRead ?? false,
        canWrite: canWrite ?? false,
        canDelete: canDelete ?? false,
        canShare: canShare ?? false,
      },
      create: {
        fileId,
        userId,
        canRead: canRead ?? false,
        canWrite: canWrite ?? false,
        canDelete: canDelete ?? false,
        canShare: canShare ?? false,
      },
    });

    return NextResponse.json({ permission: serializeBigInt(permission) });
  } catch (error) {
    console.error('Error creating permission:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove permission
export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fileId = params.id;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await prisma.filePermission.delete({
      where: {
        fileId_userId: {
          fileId,
          userId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting permission:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
