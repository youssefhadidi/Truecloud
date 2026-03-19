/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { removeModule, updateModule } from '@/lib/moduleManager';

/**
 * DELETE /api/admin/modules/{name} — remove a module
 * Query param: ?deleteDatabase=true to also remove the module's SQLite database
 */
export async function DELETE(req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { name } = await params;
    const url = new URL(req.url);
    const deleteDatabase = url.searchParams.get('deleteDatabase') === 'true';

    const result = removeModule(name, { deleteDatabase });
    return NextResponse.json({ ...result, message: 'Module removed. Rebuild required.' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/modules/{name} — update a module (re-clone latest)
 */
export async function PUT(req, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { name } = await params;
    const mod = await updateModule(name);
    return NextResponse.json({ module: mod, message: 'Module updated. Rebuild required.' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
