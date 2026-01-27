/** @format */

'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { FiUsers, FiCheckSquare, FiFileText, FiArrowLeft } from 'react-icons/fi';
import Link from 'next/link';

export default function AdminLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.push('/files');
    }
  }, [status, session, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (session?.user?.role !== 'admin') {
    return null;
  }

  const navItems = [
    { href: '/admin/accounts', icon: FiUsers, label: 'Accounts' },
    { href: '/admin/requirements', icon: FiCheckSquare, label: 'System Requirements' },
    { href: '/admin/logs', icon: FiFileText, label: 'Logs' },
  ];

  return (
    <div className="bg-gray-900 flex flex-grow flex-col lg:flex-row">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className="hidden lg:flex w-64 bg-gray-800 border-r border-gray-700 flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <Link href="/files" className="flex items-center gap-2 text-gray-300 hover:text-white mb-4 transition-colors">
            <FiArrowLeft />
            <span>Back to Files</span>
          </Link>
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header - shown only on mobile */}
        <div className="lg:hidden bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
          <Link href="/files" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
            <FiArrowLeft size={20} />
            <span className="text-sm">Back</span>
          </Link>
          <h1 className="text-lg font-bold text-white">Admin Panel</h1>
          <div className="w-16"></div> {/* Spacer for centering */}
        </div>

        {/* Page content - with bottom padding on mobile for navbar */}
        <div className="flex-1 overflow-auto pb-0 lg:pb-0">
          <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">{children}</div>
        </div>

        {/* Mobile Bottom Navigation - hidden on desktop */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 safe-area-bottom">
          <ul className="flex justify-around items-center px-2 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors ${
                      isActive ? 'bg-blue-600 text-white' : 'text-gray-300 active:bg-gray-700'
                    }`}
                  >
                    <Icon size={22} />
                    <span className="text-xs truncate max-w-full">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
