/** @format */

/**
 * Torrent Index Search API
 *
 * GET: Search the public torrent index and return normalised results, each
 *      carrying a ready-to-use `magnet` string that can be posted straight to
 *      /api/files/torrent-download.
 *
 *   Query params:
 *     q        (required) search term, min 2 characters
 *     cat      category code (0 = all, default 0)
 *     sort     seeders | leechers | size | added | name  (default seeders)
 *     order    desc | asc                                (default desc)
 *     page     1-based; anything above 1 forces the HTML mirror source
 *     id       when present, returns details for that single torrent instead
 *
 * The upstream index is fetched server-side rather than from the browser: it
 * rejects non-browser User-Agents, sends no CORS headers, and this keeps the
 * client from talking to a third-party host directly.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { logger } from '@/lib/logger';
import { searchTorrents, getTorrentDetails, SEARCH_CATEGORIES, SORT_FIELDS } from '@/lib/torrentSearch';

export async function GET(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(req.url);

    // Details mode: ?id=12345
    const id = searchParams.get('id');
    if (id) {
      const details = await getTorrentDetails(id);
      logger.debug('GET /api/files/torrent-search - Details fetched', { id, user: session.user.email });
      return NextResponse.json(details);
    }

    const query = (searchParams.get('q') || '').trim();
    if (query.length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 });
    }

    const category = Number(searchParams.get('cat')) || 0;
    if (!SEARCH_CATEGORIES.some((c) => c.value === category)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    const sort = searchParams.get('sort') || 'seeders';
    if (!SORT_FIELDS.includes(sort)) {
      return NextResponse.json({ error: 'Unknown sort field' }, { status: 400 });
    }

    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(searchParams.get('page')) || 1);

    const { results, source, degraded } = await searchTorrents(query, { category, sort, order, page });

    logger.info('GET /api/files/torrent-search', {
      query,
      category,
      count: results.length,
      source,
      user: session.user.email,
    });

    return NextResponse.json({
      query,
      results,
      count: results.length,
      source,
      // `degraded` means the HTML mirror answered: fewer fields, 30 rows/page.
      degraded,
      page,
    });
  } catch (error) {
    const message = error.message || 'Internal Server Error';
    logger.error('GET /api/files/torrent-search - Error', { error: message });
    // Upstream index unreachable is an availability problem, not a server bug.
    const status = /timed out|failed|unreachable|mirrors/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
