/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { lookup } from 'mime-types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// GET - List files
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const relativePath = searchParams.get('path') || '';
    const targetDir = path.join(UPLOAD_DIR, relativePath);

    // Security: prevent directory traversal
    const resolvedTarget = path.resolve(targetDir);
    const resolvedUpload = path.resolve(UPLOAD_DIR);
    if (!resolvedTarget.startsWith(resolvedUpload)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Read files from filesystem
    const fileNames = await readdir(targetDir);

    // Get file stats for each file
    const files = await Promise.all(
      fileNames.map(async (name) => {
        const filePath = path.join(targetDir, name);
        const stats = await stat(filePath);

        return {
          id: name, // Use filename as ID
          name: name,
          path: filePath,
          size: stats.size,
          mimeType: lookup(name) || 'application/octet-stream',
          isDirectory: stats.isDirectory(),
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
        };
      })
    );

    // Sort: directories first, then by name
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ files });
  } catch (error) {
    console.error('Error fetching files:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete file or directory
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const relativePath = searchParams.get('path') || '';
    const fileName = searchParams.get('id');

    if (!fileName) {
      return NextResponse.json({ error: 'File name required' }, { status: 400 });
    }

    // Construct file path
    const targetPath = path.join(UPLOAD_DIR, relativePath, fileName);

    // Security: prevent directory traversal
    const resolvedTarget = path.resolve(targetPath);
    const resolvedUpload = path.resolve(UPLOAD_DIR);
    if (!resolvedTarget.startsWith(resolvedUpload)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if it's a directory or file
    const stats = await stat(targetPath);

    if (stats.isDirectory()) {
      // Delete directory recursively
      const { rm } = await import('fs/promises');
      await rm(targetPath, { recursive: true, force: true });
    } else {
      // Delete file
      const { unlink } = await import('fs/promises');
      await unlink(targetPath);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Rename file or directory
export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const relativePath = searchParams.get('path') || '';
    const oldName = searchParams.get('id');
    const { newName } = await req.json();

    if (!oldName || !newName) {
      return NextResponse.json({ error: 'Old and new names required' }, { status: 400 });
    }

    // Construct paths
    const oldPath = path.join(UPLOAD_DIR, relativePath, oldName);
    const newPath = path.join(UPLOAD_DIR, relativePath, newName);

    // Security: prevent directory traversal
    const resolvedOld = path.resolve(oldPath);
    const resolvedNew = path.resolve(newPath);
    const resolvedUpload = path.resolve(UPLOAD_DIR);

    if (!resolvedOld.startsWith(resolvedUpload) || !resolvedNew.startsWith(resolvedUpload)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Rename using fs.rename
    const { rename } = await import('fs/promises');
    await rename(oldPath, newPath);

    return NextResponse.json({ success: true, newName });
  } catch (error) {
    console.error('Error deleting file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
