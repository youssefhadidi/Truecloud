/** @format */

'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { FiArrowLeft } from 'react-icons/fi';
import UserMenu from '@/components/UserMenu';
import UpdateChecker from '@/components/UpdateChecker';

function AuthenticatedLayoutContent({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isFilesPage = pathname === '/files';

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Show layout even while loading, instead of full-screen loading
  return (
    <div className="h-dvh bg-gray-900 flex flex-col overflow-hidden">
      {/* Persistent Header */}
      <header className="bg-gray-800 shadow flex-shrink-0">
        <div className="mx-auto px-2 sm:px-4 lg:px-8 py-2 sm:py-4">
          <div className="flex justify-between items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1
                className="text-lg sm:text-2xl font-bold text-white truncate cursor-pointer hover:text-gray-300 transition-colors flex flex-col"
                onClick={() => router.push('/files')}
              >
                {!isFilesPage && <FiArrowLeft className="text-gray-400 hover:text-white p-1" size={24} />} Truecloud
              </h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              <UserMenu email={session?.user?.email} isAdmin={session?.user?.role === 'admin'} />
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-1 flex overflow-y-auto w-full">{children}</main>

      {/* Update notification - auto-checks on first load */}
      <UpdateChecker />
    </div>
  );
}

export default function AuthenticatedLayout({ children }) {
  return <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>;
}
