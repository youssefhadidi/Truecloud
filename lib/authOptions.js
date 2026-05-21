/** @format */

import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// In-memory cache for the slow-changing lock-config fields (sessionLockEnabled
// and sessionLockTimeout). The fast-changing freshness fields (lastActivityAt
// and isSessionLocked) are always read fresh from the DB so an active user
// can never appear locked due to cache staleness, and a "Lock Now" reflects
// instantly on the next request.
//
// Maps userId -> { data: { sessionLockEnabled, sessionLockTimeout }, timestamp }
const lockSettingsCache = new Map();
const LOCK_SETTINGS_TTL = 60_000; // 60 seconds

/**
 * Clear the lock settings cache for a specific user. Called when settings
 * are mutated (PIN set, lock enabled/disabled, timeout changed).
 */
export function clearLockStatusCache(userId) {
  lockSettingsCache.delete(userId);
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

        const now = Date.now();

        // Always read the fast-changing fields fresh — these change on every
        // authenticated request and we must never serve stale "locked".
        const fresh = await prisma.user.findUnique({
          where: { id: token.id },
          select: { lastActivityAt: true, isSessionLocked: true },
        });

        if (!fresh) {
          session.user.isLocked = false;
          session.user.sessionLockEnabled = false;
          session.user.sessionLockTimeout = 15;
        } else {
          // Settings (sessionLockEnabled / sessionLockTimeout) change rarely
          // and can be cached safely; the cache is busted by settings PUT
          // and verify-pin so a real flip is reflected immediately.
          let cached = lockSettingsCache.get(token.id);
          if (!cached || (now - cached.timestamp) >= LOCK_SETTINGS_TTL) {
            const u = await prisma.user.findUnique({
              where: { id: token.id },
              select: { sessionLockEnabled: true, sessionLockTimeout: true },
            });
            cached = {
              data: {
                sessionLockEnabled: u?.sessionLockEnabled ?? false,
                sessionLockTimeout: u?.sessionLockTimeout ?? 15,
              },
              timestamp: now,
            };
            lockSettingsCache.set(token.id, cached);
          }

          const inactivityExpired = cached.data.sessionLockEnabled &&
            (now - new Date(fresh.lastActivityAt).getTime() > cached.data.sessionLockTimeout * 60 * 1000);
          const isLocked = fresh.isSessionLocked || inactivityExpired;

          session.user.isLocked = isLocked;
          session.user.sessionLockEnabled = cached.data.sessionLockEnabled;
          session.user.sessionLockTimeout = cached.data.sessionLockTimeout;
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
