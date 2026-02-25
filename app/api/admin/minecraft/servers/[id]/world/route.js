/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { importWorldZip, isRunning } from '@/lib/minecraft';

export async function POST(req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    if (isRunning(id)) {
      return NextResponse.json(
        { error: 'Stop the server before importing a world' },
        { status: 409 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('world');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No world ZIP file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await importWorldZip(server.directory, buffer);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to import world:', err);
    return NextResponse.json({ error: err.message || 'Failed to import world' }, { status: 500 });
  }
}
