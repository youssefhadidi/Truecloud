/** @format */

'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useStableSession } from '@/lib/api/session';
import { setupAxiosInterceptor } from '@/lib/axios';

const SessionLockContext = createContext();

export function SessionLockProvider({ children }) {
  const { data: session, status, update } = useStableSession();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Setup axios interceptor to catch 423 (Locked) responses
    setupAxiosInterceptor(update);

    if (status !== 'loading') {
      setIsLoading(false);
    }
  }, [status, update]);

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
          await new Promise((resolve) => setTimeout(resolve, 100));
          update();
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error unlocking:', error);
        return false;
      }
    },
    [update],
  );

  const lockNow = useCallback(async () => {
    try {
      const res = await fetch('/api/account/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        update();
      }
    } catch (error) {
      console.error('Error locking session:', error);
    }
  }, [update]);

  const updateSettings = useCallback(
    async (newSettings) => {
      try {
        const res = await fetch('/api/account/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSettings),
        });

        if (res.ok) {
          update();
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error updating settings:', error);
        return false;
      }
    },
    [update],
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
