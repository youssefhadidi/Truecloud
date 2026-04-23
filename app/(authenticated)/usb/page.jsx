/** @format */

'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FiArrowLeft, FiFolder, FiFile, FiHardDrive, FiHome, FiRefreshCw, FiChevronRight } from 'react-icons/fi';

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function UsbBrowserContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mountpoint = searchParams.get('mount') || '';
  const subPath = searchParams.get('sub') || '';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!mountpoint) {
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/usb-drives/ls?mountpoint=${encodeURIComponent(mountpoint)}&path=${encodeURIComponent(subPath)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mountpoint, subPath]);

  useEffect(() => { load(); }, [load]);

  const crumbs = useMemo(() => {
    const parts = subPath.split('/').filter(Boolean);
    const acc = [];
    let running = '';
    for (const part of parts) {
      running = running ? `${running}/${part}` : part;
      acc.push({ name: part, sub: running });
    }
    return acc;
  }, [subPath]);

  const setSub = (newSub) => {
    const params = new URLSearchParams();
    params.set('mount', mountpoint);
    if (newSub) params.set('sub', newSub);
    router.push(`/usb?${params.toString()}`);
  };

  const goUp = () => {
    const parent = subPath.split('/').filter(Boolean).slice(0, -1).join('/');
    setSub(parent);
  };

  const handleClick = (item) => {
    if (!item.isDirectory) return;
    const next = subPath ? `${subPath}/${item.name}` : item.name;
    setSub(next);
  };

  if (!mountpoint) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 p-8">
        No drive selected. Plug in a USB drive and pick it from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900 text-gray-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-800 flex-wrap">
        <button
          onClick={() => router.push('/files')}
          className="p-2 rounded hover:bg-gray-700 text-gray-300"
          title="Back to files"
        >
          <FiArrowLeft size={18} />
        </button>
        <FiHardDrive size={18} className="text-indigo-400" />
        <button
          onClick={() => setSub('')}
          className="text-sm font-semibold hover:text-indigo-300 truncate max-w-[260px]"
          title={mountpoint}
        >
          {mountpoint}
        </button>
        {crumbs.map((c) => (
          <span key={c.sub} className="flex items-center gap-1 text-sm text-gray-400">
            <FiChevronRight size={14} />
            <button
              onClick={() => setSub(c.sub)}
              className="hover:text-indigo-300 truncate max-w-[200px]"
            >
              {c.name}
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {subPath && (
            <button
              onClick={goUp}
              className="p-2 rounded hover:bg-gray-700 text-gray-300"
              title="Up one level"
            >
              <FiHome size={16} />
            </button>
          )}
          <button
            onClick={load}
            className="p-2 rounded hover:bg-gray-700 text-gray-300"
            title="Refresh"
          >
            <FiRefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {error && (
          <div className="m-4 p-4 rounded bg-red-900/40 border border-red-700 text-red-200 text-sm">
            {error}
          </div>
        )}
        {!error && !loading && items.length === 0 && (
          <div className="p-8 text-center text-gray-500 text-sm">Empty folder</div>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-gray-800">
            {items.map((item) => (
              <li
                key={item.name}
                onClick={() => handleClick(item)}
                className={`flex items-center gap-3 px-4 py-2 text-sm ${
                  item.isDirectory ? 'cursor-pointer hover:bg-gray-800' : 'text-gray-300'
                }`}
              >
                {item.isDirectory ? (
                  <FiFolder size={18} className="text-indigo-400 flex-shrink-0" />
                ) : (
                  <FiFile size={18} className="text-gray-400 flex-shrink-0" />
                )}
                <span className="flex-1 truncate">{item.name}</span>
                <span className="text-xs text-gray-500 flex-shrink-0 w-20 text-right">
                  {item.isDirectory ? '' : formatSize(item.size)}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0 w-36 text-right hidden sm:block">
                  {item.mtime ? new Date(item.mtime).toLocaleString() : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function UsbBrowserPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>}>
      <UsbBrowserContent />
    </Suspense>
  );
}
