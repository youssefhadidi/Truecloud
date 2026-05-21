/** @format */

'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useStableSession, useVerifyPin, useLockAccount, useUpdateAccountSettings } from '@/lib/api/session';
import { setSessionLockedHandler } from '@/lib/axiosConfig';
import { useActivityHeartbeat } from '@/hooks/useActivityHeartbeat';

const SessionLockContext = createContext();

export function SessionLockProvider({ children }) {
  const { data: session, status, update } = useStableSession();
  const [isLoading, setIsLoading] = useState(true);

  // React Query mutations
  const verifyPinMutation = useVerifyPin();
  const lockAccountMutation = useLockAccount();
  const updateAccountSettingsMutation = useUpdateAccountSettings();

  useEffect(() => {
    // Register handler so the default axios interceptor can flip the UI
    // into locked state immediately on a 423 response.
    setSessionLockedHandler(update);
    return () => setSessionLockedHandler(null);
  }, [update]);

  useEffect(() => {
    if (status !== 'loading') {
      setIsLoading(false);
    }
  }, [status]);

  const isLocked = session?.user?.isLocked ?? false;
  const sessionLockEnabled = session?.user?.sessionLockEnabled ?? false;
  const isAuthenticated = status === 'authenticated';

  // Heartbeat only when the lock is actually configured AND the session is
  // currently usable (authenticated and not locked). No point pinging
  // activity from the lock screen or before login.
  useActivityHeartbeat({ enabled: isAuthenticated && sessionLockEnabled && !isLocked });

  const unlock = useCallback(
    async (pin) => {
      return new Promise((resolve) => {
        verifyPinMutation.mutate(pin, {
          onSuccess: (data) => {
            if (data?.success) {
              resolve({ success: true });
            } else if (data?.lockedOut) {
              resolve({ success: false, lockedOut: true, retryAfter: data.retryAfter });
            } else {
              resolve({ success: false });
            }
          },
          onError: () => {
            console.error('Error unlocking');
            resolve({ success: false });
          },
        });
      });
    },
    [verifyPinMutation],
  );

  const lockNow = useCallback(async () => {
    return new Promise((resolve) => {
      lockAccountMutation.mutate(undefined, {
        onSuccess: () => {
          resolve(true);
        },
        onError: (error) => {
          console.error('Error locking session:', error);
          resolve(false);
        },
      });
    });
  }, [lockAccountMutation]);

  const updateSettings = useCallback(
    async (newSettings) => {
      return new Promise((resolve) => {
        updateAccountSettingsMutation.mutate(newSettings, {
          onSuccess: () => resolve({ success: true }),
          onError: (error) => {
            const message = error?.response?.data?.error || 'Failed to save settings';
            resolve({ success: false, error: message });
          },
        });
      });
    },
    [updateAccountSettingsMutation],
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
