/** @format */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FiCloud } from 'react-icons/fi';
import UserMenu from '@/components/UserMenu';
import UpdateChecker from '@/components/UpdateChecker';
import JobsBadge from '@/components/JobsBadge';
import { useStableSession } from '@/lib/api/session';
import AuthProvider from '@/components/AuthProvider';
import { SessionLockProvider } from '@/contexts/SessionLockContext';
import SessionLockScreen from '@/components/SessionLockScreen';
import { WebSocketProvider } from '@/contexts/WebSocketContext';

function AuthenticatedLayoutContent({ children }) {
  const { data: session, status } = useStableSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--text)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          height: 'var(--header-h)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <button
          onClick={() => router.push('/files/list')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--r-sm)',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FiCloud size={14} color="#fff" />
          </div>
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
            }}
          >
            Truecloud
          </span>
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <JobsBadge />
          <UserMenu email={session?.user?.email} isAdmin={session?.user?.role === 'admin'} />
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>{children}</main>

      <UpdateChecker />
    </div>
  );
}

export default function AuthenticatedLayout({ children }) {
  return (
    <AuthProvider>
      <SessionLockProvider>
        <SessionLockScreen>
          <WebSocketProvider>
            <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>
          </WebSocketProvider>
        </SessionLockScreen>
      </SessionLockProvider>
    </AuthProvider>
  );
}
