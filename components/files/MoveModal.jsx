/** @format */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiChevronRight, FiFolder, FiHome, FiX } from 'react-icons/fi';

export default function MoveModal({
  open,
  title = 'Move items',
  initialPath = '',
  fetchFolders,
  onConfirm,
  onClose,
}) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath);
  }, [open, initialPath]);

  useEffect(() => {
    if (!open) return;
    let isActive = true;

    const loadFolders = async () => {
      setLoading(true);
      setError('');
      try {
        const results = await fetchFolders(currentPath);
        if (!isActive) return;
        setFolders(results || []);
      } catch (err) {
        if (!isActive) return;
        setError(err?.message || 'Failed to load folders');
        setFolders([]);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadFolders();

    return () => {
      isActive = false;
    };
  }, [open, currentPath, fetchFolders]);

  const breadcrumbParts = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-gray-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-700" aria-label="Close">
            <FiX className="text-gray-300" size={18} />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-400">
            <button
              onClick={() => setCurrentPath('')}
              className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-gray-700"
              aria-label="Go to root"
            >
              <FiHome size={14} />
              <span>Root</span>
            </button>
            {breadcrumbParts.map((part, index) => (
              <div key={`${part}-${index}`} className="flex items-center gap-1.5">
                <FiChevronRight size={12} className="text-gray-600" />
                <button
                  onClick={() => setCurrentPath(breadcrumbParts.slice(0, index + 1).join('/'))}
                  className="rounded px-2 py-1 hover:bg-gray-700"
                >
                  {part}
                </button>
              </div>
            ))}
          </div>

          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={goUp}
              disabled={!currentPath}
              className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Up one level
            </button>
            <button
              onClick={() => onConfirm(currentPath)}
              className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
            >
              Move here
            </button>
          </div>

          {loading && <p className="text-sm text-gray-400">Loading folders...</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && folders.length === 0 && !error && <p className="text-sm text-gray-400">No folders found.</p>}

          {!loading && folders.length > 0 && (
            <div className="max-h-80 overflow-auto rounded border border-gray-700">
              {folders.map((folder) => (
                <button
                  key={folder.name}
                  onClick={() => setCurrentPath(currentPath ? `${currentPath}/${folder.name}` : folder.name)}
                  className="flex w-full items-center gap-2 border-b border-gray-700 px-4 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 last:border-b-0"
                >
                  <FiFolder className="text-blue-400" size={16} />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
