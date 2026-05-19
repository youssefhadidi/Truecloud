/** @format */

'use client';

import { useStableSession } from '@/lib/api/session';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  FiUsers,
  FiCheckSquare,
  FiFileText,
  FiArrowLeft,
  FiHardDrive,
  FiImage,
  FiZap,
  FiShare2,
  FiDatabase,
  FiSliders,
  FiServer,
  FiFilm,
  FiActivity,
  FiMonitor,
  FiPackage,
  FiMenu,
  FiX,
} from 'react-icons/fi';
import Link from 'next/link';
import { useComponentsConfig } from '@/lib/api/system';

export default function AdminLayout({ children }) {
  const { data: session, status } = useStableSession();
  const router = useRouter();
  const pathname = usePathname();
  const { data: componentsData } = useComponentsConfig();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const components = componentsData?.config ?? { zfs: true, smb: true };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.push('/files');
    }
  }, [status, session, router]);

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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

  const navSections = [
    {
      label: 'Overview',
      items: [{ href: '/admin/monitoring', icon: FiMonitor, label: 'Monitoring' }],
    },
    {
      label: 'Users',
      items: [{ href: '/admin/accounts', icon: FiUsers, label: 'Accounts' }],
    },
    {
      label: 'Storage',
      items: [
        components.zfs && { href: '/admin/zfs-pools', icon: FiDatabase, label: 'ZFS Pools' },
        components.smb && { href: '/admin/smb-shares', icon: FiShare2, label: 'SMB Shares' },
      ].filter(Boolean),
    },
    {
      label: 'Media',
      items: [
        { href: '/admin/thumbnail-settings', icon: FiImage, label: 'Thumbnails' },
        components.transcoding && { href: '/admin/transcoding-settings', icon: FiFilm, label: 'Transcoding' },
        { href: '/admin/cache', icon: FiHardDrive, label: 'Cache' },
      ].filter(Boolean),
    },
    components.minecraft && {
      label: 'Services',
      items: [{ href: '/admin/minecraft', icon: FiServer, label: 'Minecraft' }],
    },
    {
      label: 'System',
      items: [
        { href: '/admin/jobs', icon: FiActivity, label: 'Jobs' },
        { href: '/admin/logs', icon: FiFileText, label: 'Logs' },
        { href: '/admin/requirements', icon: FiCheckSquare, label: 'Requirements' },
        { href: '/admin/update-status', icon: FiZap, label: 'Server Updates' },
        { href: '/admin/modules', icon: FiPackage, label: 'Modules' },
        { href: '/admin/components', icon: FiSliders, label: 'Features' },
      ],
    },
  ].filter((s) => s && s.items.length > 0);

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const isActive = pathname === item.href;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          prefetch={false}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
          }`}
        >
          <Icon size={18} />
          <span className="text-sm">{item.label}</span>
        </Link>
      </li>
    );
  };

  const renderNav = () => (
    <nav className="flex-1 p-3 overflow-y-auto">
      {navSections.map((section) => (
        <div key={section.label} className="mb-4 last:mb-0">
          <div className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{section.label}</div>
          <ul className="space-y-0.5">{section.items.map(renderNavItem)}</ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="bg-gray-900 flex flex-grow flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex w-64 bg-gray-800 border-r border-gray-700 flex-col">
        <div className="p-4 border-b border-gray-700">
          <Link href="/files" className="flex items-center gap-2 text-gray-300 hover:text-white mb-4 transition-colors">
            <FiArrowLeft />
            <span>Back to Files</span>
          </Link>
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        </div>
        {renderNav()}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="lg:hidden bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
          <Link href="/files" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
            <FiArrowLeft size={20} />
            <span className="text-sm">Back</span>
          </Link>
          <h1 className="text-lg font-bold text-white">Admin Panel</h1>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="text-gray-300 hover:text-white transition-colors p-1 -m-1"
            aria-label="Open admin menu"
          >
            <FiMenu size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
          <div className="relative w-72 max-w-[85%] bg-gray-800 border-r border-gray-700 flex flex-col shadow-xl">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h1 className="text-lg font-bold text-white">Admin Panel</h1>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="text-gray-300 hover:text-white transition-colors p-1 -m-1"
                aria-label="Close admin menu"
              >
                <FiX size={22} />
              </button>
            </div>
            {renderNav()}
          </div>
        </div>
      )}
    </div>
  );
}
