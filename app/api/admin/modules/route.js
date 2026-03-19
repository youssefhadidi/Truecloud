/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { listModules, addModule } from '@/lib/moduleManager';

/**
 * GET /api/admin/modules — list installed modules
 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const modules = listModules();
    return NextResponse.json({ modules });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/modules — install a module from git
 * Body: { repository: "https://github.com/..." }
 */
export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { repository } = await req.json();

    if (!repository || typeof repository !== 'string') {
      return NextResponse.json({ error: 'repository URL is required' }, { status: 400 });
    }

    const mod = await addModule(repository.trim());
    return NextResponse.json({ module: mod, message: 'Module installed. Rebuild required.' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
