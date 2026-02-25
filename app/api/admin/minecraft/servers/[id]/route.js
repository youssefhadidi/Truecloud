/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import {
  readServerProperties,
  writeServerProperties,
  deleteServerDirectory,
  isRunning,
} from '@/lib/minecraft';

export async function GET(_req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    const properties = await readServerProperties(server.directory);

    return NextResponse.json({ server: { ...server, isRunning: isRunning(id) }, properties });
  } catch (err) {
    console.error('Failed to get Minecraft server:', err);
    return NextResponse.json({ error: 'Failed to get server' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    const body = await req.json();
    const { maxRam, minRam, autoStart, properties } = body;

    // Update DB fields
    const updated = await prisma.minecraftServer.update({
      where: { id },
      data: {
        ...(maxRam !== undefined && { maxRam: parseInt(maxRam, 10) }),
        ...(minRam !== undefined && { minRam: parseInt(minRam, 10) }),
        ...(autoStart !== undefined && { autoStart: Boolean(autoStart) }),
      },
    });

    // Write server.properties if provided
    if (properties && typeof properties === 'object') {
      await writeServerProperties(server.directory, properties);
    }

    return NextResponse.json({ server: { ...updated, isRunning: isRunning(id) } });
  } catch (err) {
    console.error('Failed to update Minecraft server:', err);
    return NextResponse.json({ error: 'Failed to update server' }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const server = await prisma.minecraftServer.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

    if (isRunning(id)) {
      return NextResponse.json({ error: 'Stop the server before deleting it' }, { status: 409 });
    }

    await deleteServerDirectory(server.directory);
    await prisma.minecraftServer.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete Minecraft server:', err);
    return NextResponse.json({ error: 'Failed to delete server' }, { status: 500 });
  }
}
