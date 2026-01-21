/** @format */

import { NextResponse } from 'next/server';

export function middleware(request) {
  // For now, let route handlers manage their own auth
  // This can be enhanced later if needed
  const response = NextResponse.next();
  
  // Add version header to force cache invalidation on deployments
  const buildId = process.env.NEXT_BUILD_ID || new Date().getTime().toString();
  response.headers.set('X-App-Version', buildId);
  
  return response;
}

export const config = {
  matcher: ['/files/:path*', '/api/:path*'],
};
