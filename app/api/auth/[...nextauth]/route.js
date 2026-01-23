/** @format */

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log('[Auth] Missing credentials');
          return null;
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email,
          },
        });

        if (!user) {
          console.log('[Auth] User not found:', credentials.email);
          return null;
        }

        console.log('[Auth] User found:', user.email, 'Role:', user.role);
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        console.log('[Auth] Password valid:', isPasswordValid);

        if (!isPasswordValid) {
          console.log('[Auth] Invalid password for user:', user.email);
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.username = user.username;
        console.log('[Auth] JWT callback - setting token:', {
          email: user.email,
          role: user.role,
          id: user.id,
        });
      }
      return token;
    },
    async session({ session, token }) {
      console.log('[Auth] Session callback - token:', {
        email: token.email,
        role: token.role,
        id: token.id,
      });
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.username = token.username;
      }
      console.log('[Auth] Session callback - returning session:', {
        email: session.user?.email,
        role: session.user?.role,
        id: session.user?.id,
      });
      return session;
    },
    async redirect({ url, baseUrl }) {
      // If the URL is already an absolute URL on the same origin, use it
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // If it's a URL from the same origin, use it
      if (new URL(url).origin === baseUrl) return url;
      // Otherwise, return to the base URL
      return baseUrl;
    },
  },
  pages: {
    signIn: '/auth/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
