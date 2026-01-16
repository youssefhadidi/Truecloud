/** @format */

import { NextResponse } from 'next/server';

export function middleware(request) {
  // For now, let route handlers manage their own auth
  // This can be enhanced later if needed
  return NextResponse.next();
}

export const config = {
  matcher: ['/files/:path*'],
};
