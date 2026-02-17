/** @format */

import { NextResponse } from 'next/server';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { prisma } from '@/lib/prisma';

const SEARCH_RESULT_LIMIT = 500;

export async function GET(req) {
  try {
    const { session, error } = await requireAuthNoActivity();
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.trim() || '';

    // Validate query length
    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Build where clause based on user permissions
    const whereClause = {
      name: {
        contains: query,
      },
    };

    // Non-admin users can only see their own files + shared files (ownerId=null)
    if (!session.user.hasRootAccess) {
      whereClause.OR = [{ ownerId: null }, { ownerId: session.user.id }];
    }

    // Query the index with limit to prevent returning too many results
    const results = await prisma.fileIndex.findMany({
      where: whereClause,
      orderBy: [{ isDirectory: 'desc' }, { name: 'asc' }],
      take: SEARCH_RESULT_LIMIT,
      select: {
        name: true,
        path: true,
        parentPath: true,
        isDirectory: true,
        extension: true,
        size: true,
      },
    });

    // Convert BigInt size to Number for JSON serialization
    const serialized = results.map((r) => ({ ...r, size: Number(r.size) }));
    const truncated = results.length >= SEARCH_RESULT_LIMIT;

    return NextResponse.json({ results: serialized, truncated });
  } catch (error) {
    console.error('Search API error:', error?.message || error);
    console.error('Full error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
