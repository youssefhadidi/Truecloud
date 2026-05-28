/** @format */

'use client';

import { useEffect, useState, memo } from 'react';
import { FiActivity, FiCheckCircle, FiAlertTriangle, FiPieChart, FiCopy, FiFolder } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import Tabs from '@/components/ui/Tabs';
import FolderTree from './FolderTree';
import CategoryBreakdown from './CategoryBreakdown';
import DuplicatesList from './DuplicatesList';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatBytesShort(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
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

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [folders, setFolders] = useState({});
  const [categories, setCategories] = useState({});
  const [duplicates, setDuplicates] = useState([]);
  const [filesScanned, setFilesScanned] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [scanningPath, setScanningPath] = useState('');
  const [doneInfo, setDoneInfo] = useState(null);
  const [lockedPaths, setLockedPaths] = useState(new Set());
  const [activeTab, setActiveTab] = useState('overview');

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
          setDuplicates(p.duplicates || []);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Storage Usage</h1>
          <p className="text-sm text-gray-400 mt-1">
            Live recursive scan of the upload directory. The tree grows as folders are measured. Leaving the page aborts the scan.
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

      {status === 'scanning' && scanningPath && (
        <div className="text-xs text-gray-500 truncate">
          Scanning <span className="text-gray-400 font-mono">{scanningPath}</span>…
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'overview', label: 'Folders & types', icon: FiFolder },
          { key: 'duplicates', label: 'Duplicates', icon: FiCopy, badge: duplicates.length },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Folder tree</h2>
              <span className="text-xs text-gray-400 tabular-nums">{formatBytes(totalBytes)} total</span>
            </div>
            <FolderTree folders={folders} lockedPaths={lockedPaths} />
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden self-start">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <FiPieChart className="text-gray-400" size={16} />
              <h2 className="text-sm font-semibold text-white">By file type</h2>
            </div>
            <div className="p-4">
              <CategoryBreakdown categories={categories} totalBytes={totalBytes} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'duplicates' && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
            <FiCopy className="text-amber-400" size={16} />
            <h2 className="text-sm font-semibold text-white">Duplicates</h2>
            <span className="text-xs text-gray-500">matched by name + size</span>
          </div>
          <DuplicatesList duplicates={duplicates} />
        </div>
      )}
    </div>
  );
}

const StatusPill = memo(function StatusPill({ status, connected, filesScanned, totalBytes, doneInfo, error }) {
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
});
