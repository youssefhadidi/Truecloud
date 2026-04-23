/** @format */

import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'node:path';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { getMountpoints } from '@/lib/usbManager';
import { logger } from '@/lib/logger';

export async function GET(req) {
  const { error } = await requireAuthNoActivity();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const mountpoint = searchParams.get('mountpoint');
  const subPath = searchParams.get('path') || '';

  if (!mountpoint) {
    return NextResponse.json({ error: 'mountpoint is required' }, { status: 400 });
  }

  const mounts = getMountpoints();
  if (!mounts.has(mountpoint)) {
    return NextResponse.json({ error: 'Mountpoint is not a currently-detected USB drive' }, { status: 404 });
  }

  const rootResolved = resolve(mountpoint) + sep;
  const targetResolved = resolve(join(mountpoint, subPath));
  const targetWithSep = targetResolved === resolve(mountpoint) ? rootResolved : targetResolved + sep;

  if (!targetWithSep.startsWith(rootResolved)) {
    return NextResponse.json({ error: 'Path escapes the drive root' }, { status: 400 });
  }

  let entries;
  try {
    entries = await readdir(targetResolved, { withFileTypes: true });
  } catch (err) {
    logger.warn('GET /api/usb-drives/ls - readdir failed', { targetResolved, err: err.message });
    const status = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    return NextResponse.json({ error: err.code || 'Failed to read directory' }, { status });
  }

  const items = await Promise.all(
    entries.map(async (entry) => {
      const full = join(targetResolved, entry.name);
      let size = 0;
      let mtime = null;
      try {
        const st = await stat(full);
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        // entry exists but stat failed (broken symlink, perms) — still list it
      }
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size,
        mtime,
      };
    }),
  );

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return NextResponse.json({
    mountpoint,
    path: subPath,
    items,
  });
}
