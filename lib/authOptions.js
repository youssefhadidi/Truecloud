/** @format */

import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// In-memory cache for the slow-changing lock-config fields (sessionLockEnabled
// and sessionLockTimeout).
//
// Maps userId -> { data: { sessionLockEnabled, sessionLockTimeout }, timestamp }
const lockSettingsCache = new Map();
const LOCK_SETTINGS_TTL = 60_000; // 60 seconds

// Short-lived cache for the fast-changing freshness fields (lastActivityAt and
// isSessionLocked), which the session callback needs on every authenticated
// request — without it a grid of 200 thumbnails costs 200 identical queries.
// It stays exact where it matters:
// - every write to isSessionLocked (lock, verify-pin, settings) calls
//   clearLockStatusCache, so "Lock Now" still reflects on the next request;
// - bumpLastActivity patches lastActivityAt in place via noteUserActivity, so
//   an active user can't appear locked because of a stale timestamp.
// Entries hold the query promise so a burst of concurrent misses shares one
// query. globalThis because authCheck is also loaded from pages-router bundles.
//
// Maps userId -> { promise: Promise<{ lastActivityAt, isSessionLocked } | null>, timestamp }
const freshnessCache = (globalThis.__sessionFreshnessCache ??= new Map());
const FRESHNESS_TTL = 10_000; // 10 seconds

function getFreshness(userId, now) {
  const cached = freshnessCache.get(userId);
  if (cached && now - cached.timestamp < FRESHNESS_TTL) return cached.promise;
  const promise = prisma.user.findUnique({
    where: { id: userId },
    select: { lastActivityAt: true, isSessionLocked: true },
  });
  const entry = { promise, timestamp: now };
  freshnessCache.set(userId, entry);
  promise.catch(() => {
    if (freshnessCache.get(userId) === entry) freshnessCache.delete(userId);
  });
  return promise;
}

/**
 * Record a lastActivityAt write in the freshness cache so it's visible to the
 * next session check without a DB round-trip.
 */
export function noteUserActivity(userId, at) {
  const cached = freshnessCache.get(userId);
  if (!cached) return;
  cached.promise.then((fresh) => {
    if (fresh && at > fresh.lastActivityAt) fresh.lastActivityAt = at;
  }).catch(() => {});
}

/**
 * Clear the cached lock settings and lock state for a specific user. Called
 * when settings are mutated (PIN set, lock enabled/disabled, timeout changed)
 * and whenever isSessionLocked is written.
 */
export function clearLockStatusCache(userId) {
  lockSettingsCache.delete(userId);
  freshnessCache.delete(userId);
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
          language: user.language || 'en',
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
        token.language = user.language;
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
        session.user.language = token.language || 'en';

        const now = Date.now();

        // Fast-changing fields — see freshnessCache for why this is safe to cache.
        const fresh = await getFreshness(token.id, now);

        if (!fresh) {
          session.user.isLocked = false;
          session.user.sessionLockEnabled = false;
          session.user.sessionLockTimeout = 15;
          session.user.language = session.user.language || 'en';
        } else {
          // Settings (sessionLockEnabled / sessionLockTimeout) change rarely
          // and can be cached safely; the cache is busted by settings PUT
          // and verify-pin so a real flip is reflected immediately.
          // The entry holds the query promise so a burst of concurrent misses
          // shares one query.
          let cached = lockSettingsCache.get(token.id);
          if (!cached || (now - cached.timestamp) >= LOCK_SETTINGS_TTL) {
            const data = prisma.user
              .findUnique({
                where: { id: token.id },
                select: { sessionLockEnabled: true, sessionLockTimeout: true, language: true },
              })
              .then((u) => ({
                sessionLockEnabled: u?.sessionLockEnabled ?? false,
                sessionLockTimeout: u?.sessionLockTimeout ?? 15,
                language: u?.language ?? 'en',
              }));
            const entry = { data, timestamp: now };
            lockSettingsCache.set(token.id, entry);
            data.catch(() => {
              if (lockSettingsCache.get(token.id) === entry) lockSettingsCache.delete(token.id);
            });
            cached = entry;
          }
          const settings = await cached.data;

          const inactivityExpired = settings.sessionLockEnabled &&
            (now - new Date(fresh.lastActivityAt).getTime() > settings.sessionLockTimeout * 60 * 1000);
          const isLocked = fresh.isSessionLocked || inactivityExpired;

          session.user.isLocked = isLocked;
          session.user.sessionLockEnabled = settings.sessionLockEnabled;
          session.user.sessionLockTimeout = settings.sessionLockTimeout;
          session.user.language = settings.language;
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
