/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';
import { generateSmbConf, writeSmbConf, reloadSamba } from '@/lib/samba';
import { resolve } from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function GET(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const shares = await prisma.smbShare.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ shares });
  } catch (error) {
    console.error('Error fetching SMB shares:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { name, path, comment, readOnly, browsable, guestOk, validUsers } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Share name is required' }, { status: 400 });
    }

    if (name.includes('[') || name.includes(']') || name.includes(' ')) {
      return NextResponse.json(
        { error: 'Share name cannot contain brackets or spaces' },
        { status: 400 },
      );
    }

    // Validate path is within UPLOAD_DIR
    const fullPath = resolve(UPLOAD_DIR, path || '');
    const resolvedUploadDir = resolve(UPLOAD_DIR);

    if (!fullPath.startsWith(resolvedUploadDir)) {
      return NextResponse.json({ error: 'Invalid path: must be within upload directory' }, { status: 400 });
    }

    // Check if share already exists
    const existingShare = await prisma.smbShare.findUnique({
      where: { name },
    });

    if (existingShare) {
      return NextResponse.json({ error: 'Share name already exists' }, { status: 400 });
    }

    const share = await prisma.smbShare.create({
      data: {
        name,
        path: path || '',
        comment: comment || null,
        readOnly: readOnly || false,
        browsable: browsable !== false,
        guestOk: guestOk || false,
        validUsers: JSON.stringify(validUsers || []),
      },
    });

    // Regenerate and reload Samba config
    const allShares = await prisma.smbShare.findMany();
    try {
      const smbConf = generateSmbConf(allShares, UPLOAD_DIR);
      await writeSmbConf(smbConf);
      await reloadSamba();
    } catch (sambaError) {
      console.error('Error updating Samba config:', sambaError);
      // Don't fail the request if Samba update fails
    }

    return NextResponse.json(
      {
        share,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating SMB share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { id, name, path, comment, readOnly, browsable, guestOk, validUsers } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Share ID is required' }, { status: 400 });
    }

    const existingShare = await prisma.smbShare.findUnique({
      where: { id },
    });

    if (!existingShare) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // Validate new name if changed
    if (name && name !== existingShare.name) {
      if (name.includes('[') || name.includes(']') || name.includes(' ')) {
        return NextResponse.json(
          { error: 'Share name cannot contain brackets or spaces' },
          { status: 400 },
        );
      }

      const duplicateName = await prisma.smbShare.findUnique({
        where: { name },
      });

      if (duplicateName) {
        return NextResponse.json({ error: 'Share name already exists' }, { status: 400 });
      }
    }

    // Validate path if changed
    if (path !== undefined && path !== existingShare.path) {
      const fullPath = resolve(UPLOAD_DIR, path || '');
      const resolvedUploadDir = resolve(UPLOAD_DIR);

      if (!fullPath.startsWith(resolvedUploadDir)) {
        return NextResponse.json({ error: 'Invalid path: must be within upload directory' }, { status: 400 });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (path !== undefined) updateData.path = path;
    if (comment !== undefined) updateData.comment = comment || null;
    if (typeof readOnly === 'boolean') updateData.readOnly = readOnly;
    if (browsable !== undefined) updateData.browsable = browsable;
    if (typeof guestOk === 'boolean') updateData.guestOk = guestOk;
    if (validUsers !== undefined) updateData.validUsers = JSON.stringify(validUsers || []);

    const share = await prisma.smbShare.update({
      where: { id },
      data: updateData,
    });

    // Regenerate and reload Samba config
    const allShares = await prisma.smbShare.findMany();
    try {
      const smbConf = generateSmbConf(allShares, UPLOAD_DIR);
      await writeSmbConf(smbConf);
      await reloadSamba();
    } catch (sambaError) {
      console.error('Error updating Samba config:', sambaError);
      // Don't fail the request if Samba update fails
    }

    return NextResponse.json({ share });
  } catch (error) {
    console.error('Error updating SMB share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Share ID is required' }, { status: 400 });
    }

    const share = await prisma.smbShare.findUnique({
      where: { id },
    });

    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    await prisma.smbShare.delete({
      where: { id },
    });

    // Regenerate and reload Samba config
    const allShares = await prisma.smbShare.findMany();
    try {
      const smbConf = generateSmbConf(allShares, UPLOAD_DIR);
      await writeSmbConf(smbConf);
      await reloadSamba();
    } catch (sambaError) {
      console.error('Error updating Samba config:', sambaError);
      // Don't fail the request if Samba update fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting SMB share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
