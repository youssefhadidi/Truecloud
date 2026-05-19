/** @format */

'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import FavoritesSidebar from '@/components/FavoritesSidebar';
import { HomeContext } from './HomeContext';

function HomeLayoutContent({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');

  const filesPath = pathname === '/files' ? (searchParams.get('path') || '') : '';

  const sidebarCurrentPath = useMemo(() => {
    if (pathname === '/files') return filesPath;
    if (pathname === '/downloads') return '__downloads__';
    if (pathname === '/shares') return '__shares__';
    return '';
  }, [pathname, filesPath]);

  const handleNavigate = useCallback(
    (path) => {
      const target = path ? `/files?path=${encodeURIComponent(path)}` : '/files';
      if (pathname === '/files') {
        // Already on /files: dispatch a state-only event and update URL
        // directly via history. Avoids spawning a router transition that
        // could collide with whatever else the router is doing.
        window.history.pushState({ path }, '', target);
        window.dispatchEvent(new CustomEvent('tc-files-set-path', { detail: { path } }));
      } else {
        router.push(target);
      }
    },
    [router, pathname],
  );

  const handleSearchChange = useCallback(
    (q) => {
      setSearchQuery(q);
      if (pathname !== '/files' && q && q.length >= 2) {
        router.push('/files');
      }
    },
    [pathname, router],
  );

  const ctx = useMemo(
    () => ({ searchQuery, setSearchQuery }),
    [searchQuery],
  );

  return (
    <HomeContext.Provider value={ctx}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg)', minHeight: 0 }}>
        <div className="tc-sidebar-wrap">
          <FavoritesSidebar
            onNavigate={handleNavigate}
            currentPath={sidebarCurrentPath}
            searchQuery={searchQuery}
            onSearchQueryChange={handleSearchChange}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {children}
        </div>
        <style jsx>{`
          .tc-sidebar-wrap { display: none; }
          @media (min-width: 640px) {
            .tc-sidebar-wrap { display: flex; align-self: stretch; min-height: 0; }
          }
        `}</style>
      </div>
    </HomeContext.Provider>
  );
}

export default function HomeLayout({ children }) {
  return (
    <Suspense fallback={null}>
      <HomeLayoutContent>{children}</HomeLayoutContent>
    </Suspense>
  );
}
