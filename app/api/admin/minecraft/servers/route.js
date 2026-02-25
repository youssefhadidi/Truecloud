/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import {
  createServerDirectory,
  downloadPaperJar,
  writeServerProperties,
  acceptEula,
  getServerDirectory,
  isRunning,
} from '@/lib/minecraft';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const servers = await prisma.minecraftServer.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Enrich with live running state
    const enriched = servers.map((s) => ({
      ...s,
      isRunning: isRunning(s.id),
    }));

    return NextResponse.json({ servers: enriched });
  } catch (err) {
    console.error('Failed to list Minecraft servers:', err);
    return NextResponse.json({ error: 'Failed to list servers' }, { status: 500 });
  }
}

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const { name, port = 25565, maxRam = 2048, minRam = 512, paperVersion = 'latest' } = body;

    // Validate name
    if (!name || !/^[a-zA-Z0-9-_]+$/.test(name)) {
      return NextResponse.json(
        { error: 'Name must only contain letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    // Validate port
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      return NextResponse.json(
        { error: 'Port must be between 1024 and 65535' },
        { status: 400 }
      );
    }

    // Check uniqueness
    const existing = await prisma.minecraftServer.findFirst({
      where: { OR: [{ name }, { port: portNum }] },
    });
    if (existing) {
      return NextResponse.json(
        { error: existing.name === name ? 'A server with that name already exists' : 'Port already in use' },
        { status: 409 }
      );
    }

    const directory = getServerDirectory(name);

    // Create directory
    await createServerDirectory(name);

    // Download PaperMC JAR
    let resolvedVersion;
    try {
      const result = await downloadPaperJar(paperVersion, directory);
      resolvedVersion = result.mcVersion;
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to download PaperMC: ${err.message}` },
        { status: 502 }
      );
    }

    // Write server.properties
    await writeServerProperties(directory, {
      'server-port': String(portNum),
      motd: name,
      'max-players': '20',
      'online-mode': 'true',
      difficulty: 'normal',
      gamemode: 'survival',
      pvp: 'true',
    });

    // Accept EULA
    await acceptEula(directory);

    // Persist to DB
    const server = await prisma.minecraftServer.create({
      data: {
        name,
        port: portNum,
        maxRam: parseInt(maxRam, 10),
        minRam: parseInt(minRam, 10),
        autoStart: false,
        directory,
        paperVersion: resolvedVersion ?? paperVersion,
        status: 'stopped',
      },
    });

    return NextResponse.json({ server }, { status: 201 });
  } catch (err) {
    console.error('Failed to create Minecraft server:', err);
    return NextResponse.json({ error: 'Failed to create server' }, { status: 500 });
  }
}
