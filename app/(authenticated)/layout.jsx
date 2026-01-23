/** @format */

'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import UserMenu from '@/components/UserMenu';

function AuthenticatedLayoutContent({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Debug: log session data
  useEffect(() => {
    console.log('AuthenticatedLayout - Session:', {
      status,
      userRole: session?.user?.role,
      isAdmin: session?.user?.role === 'admin',
    });
  }, [status, session]);

  if (status === 'unauthenticated') {
    router.push('/auth/login');
  }

  // Show layout even while loading, instead of full-screen loading
  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden">
      {/* Persistent Header */}
      <header className="bg-white dark:bg-gray-800 shadow flex-shrink-0">
        <div className="mx-auto px-2 sm:px-4 lg:px-8 py-2 sm:py-4">
          <div className="flex justify-between items-center gap-2 sm:gap-4">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">Truecloud</h1>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              <UserMenu email={session?.user?.email} isAdmin={session?.user?.role === 'admin'} />
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-1 flex overflow-y-auto w-full">{children}</main>
    </div>
  );
}

export default function AuthenticatedLayout({ children }) {
  return <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>;
}
