/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FiActivity, FiCheckCircle, FiXCircle, FiLoader, FiClock, FiAlertCircle } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useJobs } from '@/lib/api/jobs';
import { useQueryClient } from '@tanstack/react-query';

const STATUS_ICON = {
  running:   <FiLoader size={14} className="text-blue-400 animate-spin" />,
  pending:   <FiClock size={14} className="text-gray-400" />,
  completed: <FiCheckCircle size={14} className="text-green-400" />,
  failed:    <FiXCircle size={14} className="text-red-400" />,
  cancelled: <FiAlertCircle size={14} className="text-yellow-400" />,
};

function formatDuration(startTime, endTime) {
  if (!startTime) return null;
  const end = endTime ? new Date(endTime) : new Date();
  const secs = Math.round((end - new Date(startTime)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export default function JobsBadge() {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const { data: initialJobs } = useJobs();

  // Seed from React Query on mount
  useEffect(() => {
    if (initialJobs) setJobs(initialJobs);
  }, [initialJobs]);

  // Live updates via WebSocket
  useEffect(() => {
    const unsubJob = subscribe('job-status', (msg) => {
      const updated = msg.payload;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updated.id);
        const next = idx >= 0
          ? [updated, ...prev.filter((j) => j.id !== updated.id)]
          : [updated, ...prev];
        return next.slice(0, 100);
      });
      // Keep React Query cache in sync
      queryClient.setQueryData(['jobs'], (prev) =>
        prev ? [updated, ...prev.filter((j) => j.id !== updated.id)] : [updated],
      );
      queryClient.setQueryData(['jobs', updated.id], updated);
    });

    const unsubList = subscribe('job-list', (msg) => {
      setJobs(msg.payload ?? []);
      queryClient.setQueryData(['jobs'], msg.payload ?? []);
    });

    return () => {
      unsubJob();
      unsubList();
    };
  }, [subscribe, queryClient]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
  const preview = jobs.slice(0, 5);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center gap-1.5 px-2 py-2 rounded-lg hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
        title="Jobs"
      >
        <FiActivity size={20} />
        {runningCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
            {runningCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Jobs</span>
            {runningCount > 0 && (
              <span className="text-xs text-blue-400">{runningCount} running</span>
            )}
          </div>

          {preview.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">No jobs yet</div>
          ) : (
            <ul className="divide-y divide-gray-700 max-h-72 overflow-y-auto">
              {preview.map((job) => (
                <li key={job.id} className="px-4 py-3 flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0">{STATUS_ICON[job.status] ?? STATUS_ICON.pending}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{job.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 capitalize">
                      {job.type.replace(/-/g, ' ')}
                      {job.progress > 0 && job.status === 'running' && ` · ${job.progress}%`}
                      {job.startTime && ` · ${formatDuration(job.startTime, job.endTime)}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="px-4 py-3 border-t border-gray-700">
            <button
              onClick={() => { setOpen(false); router.push('/admin/jobs'); }}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View all jobs →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
