/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const relativePath = formData.get('path') || '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Ensure target directory exists
    const targetDir = path.join(UPLOAD_DIR, relativePath);
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Security: prevent directory traversal
    if (!path.resolve(targetDir).startsWith(path.resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Save file directly to storage with original name
    const filePath = path.join(targetDir, file.name);
    await writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        path: filePath,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
