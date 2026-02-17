/** @format */

'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useStableSession, useVerifyPin, useLockAccount, useUpdateAccountSettings } from '@/lib/api/session';
import { setupAxiosInterceptor } from '@/lib/axios';

const SessionLockContext = createContext();

export function SessionLockProvider({ children }) {
  const { data: session, status, update } = useStableSession();
  const [isLoading, setIsLoading] = useState(true);

  // React Query mutations
  const verifyPinMutation = useVerifyPin();
  const lockAccountMutation = useLockAccount();
  const updateAccountSettingsMutation = useUpdateAccountSettings();

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
      return new Promise((resolve) => {
        verifyPinMutation.mutate(pin, {
          onSuccess: (data) => {
            if (data.success) {
              // Small delay to ensure session is updated
              setTimeout(() => {
                resolve(true);
              }, 100);
            } else {
              resolve(false);
            }
          },
          onError: () => {
            console.error('Error unlocking');
            resolve(false);
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
          onSuccess: () => {
            resolve(true);
          },
          onError: (error) => {
            console.error('Error updating settings:', error);
            resolve(false);
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
