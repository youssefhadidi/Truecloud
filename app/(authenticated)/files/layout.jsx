/** @format */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FavoritesSidebar from '@/components/FavoritesSidebar';
import { FilesContext } from './FilesContext';

function FilesLayoutContent({ children }) {
  const router = useRouter();
  const pathname = usePathname();

  const [searchQuery, setSearchQuery] = useState('');

  // Track the /files/list subpath ourselves. We update from initial load,
  // popstate, and the `tc-files-set-path` event the list page emits.
  const [filesPath, setFilesPath] = useState(() => {
    if (typeof window === 'undefined') return '';
    if (window.location.pathname !== '/files/list') return '';
    return new URL(window.location.href).searchParams.get('path') || '';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readPath = () => {
      if (window.location.pathname !== '/files/list') return '';
      return new URL(window.location.href).searchParams.get('path') || '';
    };
    const onPop = () => setFilesPath(readPath());
    const onSet = (e) => setFilesPath(e.detail?.path ?? readPath());
    window.addEventListener('popstate', onPop);
    window.addEventListener('tc-files-set-path', onSet);
    setFilesPath(readPath());
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('tc-files-set-path', onSet);
    };
  }, [pathname]);

  const sidebarCurrentPath = useMemo(() => {
    if (pathname === '/files/list') return filesPath;
    if (pathname === '/files/downloads') return '__downloads__';
    if (pathname === '/files/shares') return '__shares__';
    return '';
  }, [pathname, filesPath]);

  const handleNavigate = useCallback(
    (path) => {
      const target = path ? `/files/list?path=${encodeURIComponent(path)}` : '/files/list';
      if (pathname === '/files/list') {
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
      if (pathname !== '/files/list' && q && q.length >= 2) {
        router.push('/files/list');
      }
    },
    [pathname, router],
  );

  const ctx = useMemo(
    () => ({ searchQuery, setSearchQuery }),
    [searchQuery],
  );

  return (
    <FilesContext.Provider value={ctx}>
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
    </FilesContext.Provider>
  );
}

export default function FilesLayout({ children }) {
  return <FilesLayoutContent>{children}</FilesLayoutContent>;
}
