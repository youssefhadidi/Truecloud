/** @format */

import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Add version header to force cache invalidation on deployments
  const buildId = process.env.NEXT_BUILD_ID || new Date().getTime().toString();

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const isAuthenticated = !!token;

  // Root: redirect based on auth status
  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(isAuthenticated ? '/files' : '/auth/login', request.url)
    );
  }

  // Auth routes (/auth/*): allow through — never redirect to login from here
  if (pathname.startsWith('/auth/')) {
    // If already authenticated, bounce away from login page
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/files', request.url));
    }
    return NextResponse.next();
  }

  // Protected routes: redirect to login if not authenticated
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const response = NextResponse.next();
  response.headers.set('X-App-Version', buildId);
  return response;
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
