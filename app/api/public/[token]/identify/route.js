/** @format */

import { NextResponse } from 'next/server';
import {
  verifyShare, clientIpFromHeaders, normalizeShareEmail, shareEmailCookieName,
} from '@/lib/shareAuth';

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

async function verify(req, token) {
  const password = req.headers.get('x-share-password');
  const verification = await verifyShare(token, password, clientIpFromHeaders(req));
  if (verification.valid) return { share: verification.share };
  if (verification.rateLimited) {
    return {
      error: NextResponse.json(
        { error: verification.error },
        { status: 429, headers: { 'Retry-After': String(verification.retryAfter || 60) } }
      ),
    };
  }
  if (verification.requiresPassword) {
    return { error: NextResponse.json({ error: 'Password required' }, { status: 401 }) };
  }
  return { error: NextResponse.json({ error: verification.error }, { status: 404 }) };
}

function cookieOptions(req, token, maxAge) {
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: `/api/public/${token}`,
    maxAge,
  };
}

// POST - Set the visitor email for a privateUploads share
export async function POST(req, { params }) {
  try {
    const { token } = await params;
    const { share, error } = await verify(req, token);
    if (error) return error;

    if (!share.privateUploads) {
      return NextResponse.json({ error: 'Not a private-uploads share' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const email = normalizeShareEmail(body?.email);
    if (!email) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const res = NextResponse.json({ success: true, email });
    res.cookies.set(shareEmailCookieName(token), encodeURIComponent(email), cookieOptions(req, token, COOKIE_MAX_AGE));
    return res;
  } catch (error) {
    console.error('POST /api/public/[token]/identify - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Forget the visitor email
export async function DELETE(req, { params }) {
  try {
    const { token } = await params;
    const res = NextResponse.json({ success: true });
    res.cookies.set(shareEmailCookieName(token), '', cookieOptions(req, token, 0));
    return res;
  } catch (error) {
    console.error('DELETE /api/public/[token]/identify - Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
