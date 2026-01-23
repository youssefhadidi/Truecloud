/** @format */

'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { initVersionChecker } from '@/lib/versionCheck';

export default function AuthProvider({ children }) {
  useEffect(() => {
    // Start version checking on client mount
    initVersionChecker();
  }, []);

  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
