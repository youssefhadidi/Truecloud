/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { mkdir } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, path: relativePath } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Folder name required' }, { status: 400 });
    }

    const targetPath = path.join(UPLOAD_DIR, relativePath || '', name);

    // Security: prevent directory traversal
    if (!path.resolve(targetPath).startsWith(path.resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    await mkdir(targetPath, { recursive: true });

    return NextResponse.json({
      success: true,
      folder: {
        name: name,
        path: targetPath,
      },
    });
  } catch (error) {
    console.error('Create folder error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
