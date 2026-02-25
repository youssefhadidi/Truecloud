/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { spawnServer, isRunning } from '@/lib/minecraft';

export async function POST(_req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    if (isRunning(id)) {
      return NextResponse.json({ error: 'Server is already running' }, { status: 409 });
    }

    // spawnServer is non-blocking — it sets up the process and returns
    await spawnServer(server, prisma);

    return NextResponse.json({ status: 'starting' });
  } catch (err) {
    console.error('Failed to start Minecraft server:', err);
    return NextResponse.json({ error: err.message || 'Failed to start server' }, { status: 500 });
  }
}
