/** @format */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiActivity, FiCheckCircle, FiAlertTriangle, FiChevronRight, FiHome, FiPieChart } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import FolderTree from './FolderTree';
import CategoryBreakdown from './CategoryBreakdown';

// Matches MAX_TRACKED_DEPTH in lib/storageScanner.js — UI must not let the
// admin drill past what the server is actually tracking.
const MAX_DEPTH = 4;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export default function StorageClient() {
  const { subscribe, connected } = useWebSocket();

  const [status, setStatus] = useState('idle'); // idle | scanning | done | error | denied
  const [error, setError] = useState(null);
  const [folders, setFolders] = useState({});
  const [categories, setCategories] = useState({});
  const [filesScanned, setFilesScanned] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [currentPath, setCurrentPath] = useState('');
  const [scanningPath, setScanningPath] = useState('');
  const [doneInfo, setDoneInfo] = useState(null);
  const [lockedPaths, setLockedPaths] = useState(new Set());

  // Subscribe to the storage-scan channel. The first subscribe kicks off the
  // server-side walker; unmount/unsubscribe aborts it.
  useEffect(() => {
    setStatus('scanning');
    const unsub = subscribe('storage-scan', (msg) => {
      const p = msg.payload;
      if (!p) return;
      switch (p.event) {
        case 'start':
          setStatus('scanning');
          setError(null);
          setDoneInfo(null);
          break;
        case 'progress':
          setFolders(p.folders || {});
          setCategories(p.categories || {});
          setFilesScanned(p.filesScanned || 0);
          setTotalBytes(p.totalBytes || 0);
          setScanningPath(p.currentPath || '');
          break;
        case 'done':
          setStatus('done');
          setTotalBytes(p.totalBytes || 0);
          setFilesScanned(p.filesScanned || 0);
          setDoneInfo({ durationMs: p.durationMs || 0 });
          break;
        case 'error':
          setStatus('error');
          setError(p.message || 'Scan failed');
          break;
        case 'denied':
          setStatus('denied');
          setError(p.reason || 'Access denied');
          break;
        default:
          break;
      }
    });
    return unsub;
  }, [subscribe]);

  // Load the locked-paths overlay once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/storage/locked-paths')
      .then((r) => (r.ok ? r.json() : { paths: [] }))
      .then((data) => {
        if (!cancelled) setLockedPaths(new Set(data.paths || []));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const breadcrumb = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/');
    return parts.map((seg, i) => ({
      label: seg,
      path: parts.slice(0, i + 1).join('/'),
    }));
  }, [currentPath]);

  const currentFolderBytes = currentPath ? folders[currentPath] || 0 : totalBytes;

  return (
    <div className="space-y-6">
      {/* Header / status bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Storage Usage</h1>
          <p className="text-sm text-gray-400 mt-1">
            Live recursive scan of the upload directory. Cancels when you leave the page.
          </p>
        </div>
        <StatusPill
          status={status}
          connected={connected}
          filesScanned={filesScanned}
          totalBytes={totalBytes}
          doneInfo={doneInfo}
          error={error}
        />
      </div>

      {/* Scanning-path ticker */}
      {status === 'scanning' && scanningPath && (
        <div className="text-xs text-gray-500 truncate">
          Scanning <span className="text-gray-400 font-mono">{scanningPath}</span>…
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center flex-wrap gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => setCurrentPath('')}
          className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
            currentPath ? 'text-gray-300 hover:bg-gray-800' : 'text-white bg-gray-800'
          }`}
        >
          <FiHome size={14} />
          <span>root</span>
          <span className="ml-1 text-xs text-gray-500 tabular-nums">{formatBytes(totalBytes)}</span>
        </button>
        {breadcrumb.map((b) => (
          <div key={b.path} className="flex items-center gap-1.5">
            <FiChevronRight className="text-gray-600" size={14} />
            <button
              type="button"
              onClick={() => setCurrentPath(b.path)}
              className={`px-2 py-1 rounded transition-colors ${
                b.path === currentPath ? 'text-white bg-gray-800' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span>{b.label}</span>
              <span className="ml-1 text-xs text-gray-500 tabular-nums">
                {formatBytes(folders[b.path] || 0)}
              </span>
            </button>
          </div>
        ))}
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Folders</h2>
            <span className="text-xs text-gray-400 tabular-nums">
              {currentPath ? formatBytes(currentFolderBytes) : `${formatBytes(totalBytes)} total`}
            </span>
          </div>
          <FolderTree
            folders={folders}
            currentPath={currentPath}
            onNavigate={setCurrentPath}
            lockedPaths={lockedPaths}
            maxDepth={MAX_DEPTH}
          />
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
            <FiPieChart className="text-gray-400" size={16} />
            <h2 className="text-sm font-semibold text-white">By file type</h2>
          </div>
          <div className="p-4">
            <CategoryBreakdown categories={categories} totalBytes={totalBytes} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, connected, filesScanned, totalBytes, doneInfo, error }) {
  let icon = null;
  let label = '';
  let color = 'bg-gray-700 text-gray-300';

  if (!connected) {
    icon = <FiAlertTriangle size={14} />;
    label = 'Disconnected';
    color = 'bg-red-900/40 text-red-300 border border-red-700/50';
  } else if (status === 'scanning') {
    icon = <FiActivity size={14} className="animate-pulse" />;
    label = `Scanning · ${filesScanned.toLocaleString()} files · ${formatBytesShort(totalBytes)}`;
    color = 'bg-blue-900/40 text-blue-200 border border-blue-700/50';
  } else if (status === 'done') {
    icon = <FiCheckCircle size={14} />;
    label = `Done · ${filesScanned.toLocaleString()} files · ${formatBytesShort(totalBytes)}${
      doneInfo ? ` · ${formatDuration(doneInfo.durationMs)}` : ''
    }`;
    color = 'bg-green-900/40 text-green-200 border border-green-700/50';
  } else if (status === 'error' || status === 'denied') {
    icon = <FiAlertTriangle size={14} />;
    label = error || 'Error';
    color = 'bg-red-900/40 text-red-300 border border-red-700/50';
  } else {
    label = 'Idle';
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${color}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function formatBytesShort(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
