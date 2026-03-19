/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import fs from 'fs';
import path from 'path';

const LIBRARY_PATH = path.join(process.cwd(), 'library.json');

function readLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf-8'));
  } catch {
    return { modules: [] };
  }
}

function writeLibrary(data) {
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(data, null, 2) + '\n');
}

/**
 * GET /api/admin/modules/library — list available modules from library
 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const library = readLibrary();
    return NextResponse.json(library);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/modules/library — add a module to the library
 * Body: { name, description, repository }
 */
export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { name, description, repository } = await req.json();

    if (!name || !repository) {
      return NextResponse.json({ error: 'name and repository are required' }, { status: 400 });
    }

    const library = readLibrary();

    if (library.modules.some((m) => m.repository === repository)) {
      return NextResponse.json({ error: 'This repository is already in the library' }, { status: 409 });
    }

    library.modules.push({
      name: name.trim(),
      description: (description || '').trim(),
      repository: repository.trim(),
      addedAt: new Date().toISOString(),
    });

    writeLibrary(library);
    return NextResponse.json({ modules: library.modules });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/modules/library — remove a module from the library
 * Body: { repository }
 */
export async function DELETE(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { repository } = await req.json();

    if (!repository) {
      return NextResponse.json({ error: 'repository is required' }, { status: 400 });
    }

    const library = readLibrary();
    library.modules = library.modules.filter((m) => m.repository !== repository);
    writeLibrary(library);

    return NextResponse.json({ modules: library.modules });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
