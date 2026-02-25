/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { getConsoleBuffer } from '@/lib/minecraft';

export async function GET(_req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    const lines = getConsoleBuffer(id);
    return NextResponse.json({ lines });
  } catch (err) {
    console.error('Failed to get logs:', err);
    return NextResponse.json({ error: 'Failed to get logs' }, { status: 500 });
  }
}
