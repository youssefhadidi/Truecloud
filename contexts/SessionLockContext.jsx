/** @format */

'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const SessionLockContext = createContext();

export function SessionLockProvider({ children }) {
  const [isLocked, setIsLocked] = useState(false);
  const [settings, setSettings] = useState({
    sessionLockEnabled: false,
    sessionLockTimeout: 15,
    lastActivityAt: new Date(),
  });
  const [isLoading, setIsLoading] = useState(true);

  // Fetch settings from backend
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/account/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({
          sessionLockEnabled: data.sessionLockEnabled,
          sessionLockTimeout: data.sessionLockTimeout,
          lastActivityAt: new Date(data.lastActivityAt),
        });

        // Check if should be locked
        if (data.sessionLockEnabled) {
          const lastActivity = new Date(data.lastActivityAt).getTime();
          const now = Date.now();
          const timeoutMs = data.sessionLockTimeout * 60 * 1000;

          if (now - lastActivity > timeoutMs) {
            setIsLocked(true);
          } else {
            setIsLocked(false);
          }
        } else {
          setIsLocked(false);
        }
      }
    } catch (error) {
      console.error('Error fetching session lock settings:', error);
    }
  }, []);

  // Fetch settings on mount
  useEffect(() => {
    fetchSettings();
    setIsLoading(false);
  }, [fetchSettings]);

  // Poll for lock status every 30 seconds
  useEffect(() => {
    if (isLoading) return;

    const interval = setInterval(() => {
      fetchSettings();
    }, 30000);

    return () => clearInterval(interval);
  }, [isLoading, fetchSettings]);

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
          setIsLocked(false);
          // Refresh settings to update lastActivityAt
          fetchSettings();
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error unlocking:', error);
        return false;
      }
    },
    [fetchSettings]
  );

  const lockNow = useCallback(() => {
    setIsLocked(true);
  }, []);

  const updateSettings = useCallback(
    async (newSettings) => {
      try {
        const res = await fetch('/api/account/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSettings),
        });

        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => ({
            ...prev,
            sessionLockEnabled: data.sessionLockEnabled,
            sessionLockTimeout: data.sessionLockTimeout,
          }));
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error updating settings:', error);
        return false;
      }
    },
    []
  );

  const value = {
    isLocked,
    settings,
    unlock,
    lockNow,
    updateSettings,
  };

  return (
    <SessionLockContext.Provider value={value}>
      {children}
    </SessionLockContext.Provider>
  );
}

export function useSessionLock() {
  const context = useContext(SessionLockContext);
  if (!context) {
    throw new Error('useSessionLock must be used within SessionLockProvider');
  }
  return context;
}
