/** @format */

'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { setupAxiosInterceptor } from '@/lib/axios';

const SessionLockContext = createContext();

export function SessionLockProvider({ children }) {
  const { data: session, update: updateSession, status } = useSession();
  const [isLoading, setIsLoading] = useState(true);

  // Initialize and poll for lock status every 30 seconds
  useEffect(() => {
    // Setup axios interceptor to catch 423 (Locked) responses
    setupAxiosInterceptor(updateSession);

    // Only consider loading done when NextAuth session is loaded
    if (status !== 'loading') {
      setIsLoading(false);
    }

    // Poll for session updates every 30 seconds (inactivity detection)
    const interval = setInterval(() => {
      updateSession();
    }, 30000);

    return () => clearInterval(interval);
  }, [status, updateSession]);

  const isLocked = session?.user?.isLocked ?? false;

  const unlock = useCallback(
    async (pin) => {
      try {
        const res = await fetch('/api/account/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });

        const data = await res.json();

        if (data.success) {
          // Wait a moment for DB to settle, then refresh session
          await new Promise((resolve) => setTimeout(resolve, 100));
          await updateSession();
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error unlocking:', error);
        return false;
      }
    },
    [updateSession],
  );

  const lockNow = useCallback(async () => {
    try {
      const res = await fetch('/api/account/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        // Refresh session to get updated isLocked status
        await updateSession();
      }
    } catch (error) {
      console.error('Error locking session:', error);
    }
  }, [updateSession]);

  const updateSettings = useCallback(
    async (newSettings) => {
      try {
        const res = await fetch('/api/account/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSettings),
        });

        if (res.ok) {
          // Refresh session after settings update
          await updateSession();
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error updating settings:', error);
        return false;
      }
    },
    [updateSession],
  );

  const settings = {
    sessionLockEnabled: session?.user?.sessionLockEnabled,
    sessionLockTimeout: session?.user?.sessionLockTimeout,
  };

  const value = {
    isLocked,
    isLoading,
    settings,
    unlock,
    lockNow,
    updateSettings,
  };

  return <SessionLockContext.Provider value={value}>{children}</SessionLockContext.Provider>;
}

export function useSessionLock() {
  const context = useContext(SessionLockContext);
  if (!context) {
    throw new Error('useSessionLock must be used within SessionLockProvider');
  }
  return context;
}
