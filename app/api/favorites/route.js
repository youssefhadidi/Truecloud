/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

// GET - List all favorites for current user
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const favorites = await prisma.favorite.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ favorites });
  } catch (error) {
    logger.error('GET /api/favorites - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Add a new favorite
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { path, name, isDirectory } = await req.json();

    if (!path || !name) {
      return NextResponse.json({ error: 'Path and name are required' }, { status: 400 });
    }

    // Check if already favorited
    const existing = await prisma.favorite.findUnique({
      where: {
        path_ownerId: {
          path,
          ownerId: session.user.id,
        },
      },
    });

    if (existing) {
      return NextResponse.json({ error: 'Already in favorites' }, { status: 409 });
    }

    const favorite = await prisma.favorite.create({
      data: {
        path,
        name,
        isDirectory: isDirectory || false,
        ownerId: session.user.id,
      },
    });

    logger.info('POST /api/favorites - Favorite added', { path, userId: session.user.id });
    return NextResponse.json({ favorite });
  } catch (error) {
    logger.error('POST /api/favorites - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove a favorite
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const path = searchParams.get('path');

    if (!id && !path) {
      return NextResponse.json({ error: 'ID or path required' }, { status: 400 });
    }

    let deleted;

    if (id) {
      // Delete by ID
      deleted = await prisma.favorite.deleteMany({
        where: {
          id,
          ownerId: session.user.id,
        },
      });
    } else {
      // Delete by path
      deleted = await prisma.favorite.deleteMany({
        where: {
          path,
          ownerId: session.user.id,
        },
      });
    }

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Favorite not found' }, { status: 404 });
    }

    logger.info('DELETE /api/favorites - Favorite removed', { id, path, userId: session.user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/favorites - Error', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
