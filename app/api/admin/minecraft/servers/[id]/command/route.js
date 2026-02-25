/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { sendCommand, isRunning } from '@/lib/minecraft';

export async function POST(req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const { command } = await req.json();

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'command is required' }, { status: 400 });
    }

    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    if (!isRunning(id)) {
      return NextResponse.json({ error: 'Server is not running' }, { status: 409 });
    }

    sendCommand(id, command.trim());

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('Failed to send command:', err);
    return NextResponse.json({ error: err.message || 'Failed to send command' }, { status: 500 });
  }
}
