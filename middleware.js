/** @format */

import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = request.nextUrl;
  const isAuthenticated = !!token;

  // Root: redirect based on auth status
  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(isAuthenticated ? '/files' : '/auth/login', request.url)
    );
  }

  // Login page: redirect to /files if already authenticated
  if (pathname.startsWith('/auth/login') && isAuthenticated) {
    return NextResponse.redirect(new URL('/files', request.url));
  }

  // Protected routes: redirect to login if not authenticated
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api routes
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico
     * - s/ (public share routes - no auth required)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|s/).*)',
  ],
};
