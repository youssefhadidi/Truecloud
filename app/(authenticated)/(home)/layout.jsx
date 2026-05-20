/** @format */

'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FavoritesSidebar from '@/components/FavoritesSidebar';
import { HomeContext } from './HomeContext';

function HomeLayoutContent({ children }) {
  const router = useRouter();
  const pathname = usePathname();

  const [searchQuery, setSearchQuery] = useState('');

  // Track the /files subpath ourselves — reading via useSearchParams subscribes
  // this layout to every URL change and (in 16.x) appears to interfere with
  // outgoing router transitions when the param is absent. We update this from
  // initial load, popstate, and the same custom event /files uses.
  const [filesPath, setFilesPath] = useState(() => {
    if (typeof window === 'undefined') return '';
    if (window.location.pathname !== '/files') return '';
    return new URL(window.location.href).searchParams.get('path') || '';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readPath = () => {
      if (window.location.pathname !== '/files') return '';
      return new URL(window.location.href).searchParams.get('path') || '';
    };
    const onPop = () => setFilesPath(readPath());
    const onSet = (e) => setFilesPath(e.detail?.path ?? readPath());
    window.addEventListener('popstate', onPop);
    window.addEventListener('tc-files-set-path', onSet);
    // Resync on pathname changes (e.g. routing to /files from /downloads)
    setFilesPath(readPath());
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('tc-files-set-path', onSet);
    };
  }, [pathname]);

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
