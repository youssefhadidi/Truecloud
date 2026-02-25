/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { stopServer, isRunning } from '@/lib/minecraft';

export async function POST(_req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    if (!isRunning(id)) {
      return NextResponse.json({ error: 'Server is not running' }, { status: 409 });
    }

    await stopServer(id, prisma);

    return NextResponse.json({ status: 'stopping' });
  } catch (err) {
    console.error('Failed to stop Minecraft server:', err);
    return NextResponse.json({ error: err.message || 'Failed to stop server' }, { status: 500 });
  }
}
