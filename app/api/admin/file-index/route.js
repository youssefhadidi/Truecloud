/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';

export async function DELETE(req) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const deleted = await prisma.fileIndex.deleteMany({});

    return NextResponse.json({
      success: true,
      deletedCount: deleted.count,
    });
  } catch (error) {
    console.error('File index clear error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
