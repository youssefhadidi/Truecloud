/** @format */

import NextAuth from 'next-auth';
import { authOptions } from '@/lib/authOptions';

export const { handlers, signIn, signOut, auth } = NextAuth(authOptions);

export const GET = handlers.GET;
export const POST = handlers.POST;
