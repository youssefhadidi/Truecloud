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
    <div className="bg-gray-900 flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
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
      <div className="flex-1 flex flex-col">
        {/* Page content */}
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
