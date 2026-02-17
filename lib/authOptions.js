/** @format */

import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// In-memory cache for session lock status to reduce DB queries
// Maps userId -> { data, timestamp }
const lockStatusCache = new Map();
const LOCK_CACHE_TTL = 60_000; // 60 seconds

/**
 * Clear the lock status cache for a specific user
 * Used when lock status changes (PIN verified, session locked, etc.)
 */
export function clearLockStatusCache(userId) {
  lockStatusCache.delete(userId);
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email,
          },
        });

        if (!user) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          role: user.role,
          hasRootAccess: user.hasRootAccess || user.role === 'admin',
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
        token.hasRootAccess = user.hasRootAccess;
      }
      // Initialize or update cache timestamp for lock status queries
      if (!token.lockCacheTime) {
        token.lockCacheTime = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.username = token.username;
        session.user.hasRootAccess = token.hasRootAccess;

        // Use in-memory cache to reduce DB queries (60 second TTL)
        const now = Date.now();
        const cached = lockStatusCache.get(token.id);
        const cacheValid = cached && (now - cached.timestamp) < LOCK_CACHE_TTL;

        if (cacheValid) {
          // Use cached values
          session.user.isLocked = cached.data.isLocked;
          session.user.sessionLockEnabled = cached.data.sessionLockEnabled;
          session.user.sessionLockTimeout = cached.data.sessionLockTimeout;
        } else {
          // Refresh from DB
          const user = await prisma.user.findUnique({
            where: { id: token.id },
            select: { sessionLockEnabled: true, sessionLockTimeout: true, lastActivityAt: true, isSessionLocked: true }
          });

          if (user) {
            const inactivityExpired = user.sessionLockEnabled &&
              (now - new Date(user.lastActivityAt).getTime() > user.sessionLockTimeout * 60 * 1000);
            const isLocked = user.isSessionLocked || inactivityExpired;

            // Cache the values
            lockStatusCache.set(token.id, {
              data: {
                isLocked,
                sessionLockEnabled: user.sessionLockEnabled,
                sessionLockTimeout: user.sessionLockTimeout,
              },
              timestamp: now,
            });

            session.user.isLocked = isLocked;
            session.user.sessionLockEnabled = user.sessionLockEnabled;
            session.user.sessionLockTimeout = user.sessionLockTimeout;
          } else {
            // User not found, use defaults
            lockStatusCache.set(token.id, {
              data: {
                isLocked: false,
                sessionLockEnabled: false,
                sessionLockTimeout: 15,
              },
              timestamp: now,
            });

            session.user.isLocked = false;
            session.user.sessionLockEnabled = false;
            session.user.sessionLockTimeout = 15;
          }
        }
      }
      // Remove expires to keep the session object stable across polls
      // (prevents unnecessary re-renders on the frontend)
      delete session.expires;
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
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
};
