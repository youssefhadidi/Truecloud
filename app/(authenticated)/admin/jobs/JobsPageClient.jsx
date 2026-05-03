/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiActivity, FiCheckCircle, FiXCircle, FiLoader, FiClock, FiAlertCircle, FiChevronDown, FiChevronUp, FiSlash } from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useJobs, useCancelJob } from '@/lib/api/jobs';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from '@/lib/timeAgo';

// ─── Constants ────────────────────────────────────────────────────────────────

const FILTERS = ['all', 'running', 'completed', 'failed', 'cancelled'];

const STATUS_CONFIG = {
  running:   { icon: FiLoader,      color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30',  label: 'Running',   spin: true },
  pending:   { icon: FiClock,       color: 'text-gray-400',   bg: 'bg-gray-500/10 border-gray-500/30',  label: 'Pending',   spin: false },
  completed: { icon: FiCheckCircle, color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30', label: 'Completed', spin: false },
  failed:    { icon: FiXCircle,     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',    label: 'Failed',    spin: false },
  cancelled: { icon: FiAlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', label: 'Cancelled', spin: false },
};

const TYPE_COLORS = {
  'cache-generation':   'bg-purple-500/20 text-purple-300',
  'hls-transcode':      'bg-cyan-500/20 text-cyan-300',
  'transcode':          'bg-cyan-500/20 text-cyan-300',
  'install-requirement':'bg-orange-500/20 text-orange-300',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(startTime, endTime) {
  if (!startTime) return '—';
  const end = endTime ? new Date(endTime) : new Date();
  const secs = Math.max(0, Math.round((end - new Date(startTime)) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function typeLabel(type) {
  return type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── JobCard ──────────────────────────────────────────────────────────────────

function JobCard({ job }) {
  const [expanded, setExpanded] = useState(false);
  const cancelJob = useCancelJob();
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      {/* Header row */}
      <div className="p-4 flex items-start gap-3">
        <Icon size={18} className={`${cfg.color} flex-shrink-0 mt-0.5 ${cfg.spin ? 'animate-spin' : ''}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">{job.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[job.type] ?? 'bg-gray-500/20 text-gray-300'}`}>
              {typeLabel(job.type)}
            </span>
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
            {job.startTime && (
              <span title={new Date(job.startTime).toLocaleString()}>
                Started {formatDistanceToNow(new Date(job.startTime), { addSuffix: true })}
              </span>
            )}
            <span>Duration: {formatDuration(job.startTime, job.endTime)}</span>
            {job.progress > 0 && job.status === 'running' && (
              <span className="text-blue-400">{job.progress}%</span>
            )}
          </div>

          {/* Progress bar for running jobs */}
          {job.status === 'running' && job.progress > 0 && (
            <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}

          {job.error && (
            <p className="mt-1 text-xs text-red-400 truncate">{job.error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {(job.status === 'running' || job.status === 'pending') && (
            <button
              onClick={() => cancelJob.mutate(job.id)}
              disabled={cancelJob.isPending}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
              title="Cancel job"
            >
              <FiSlash size={14} />
            </button>
          )}
          {job.logs.length > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              title={expanded ? 'Hide logs' : 'Show logs'}
            >
              {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Log panel */}
      {expanded && job.logs.length > 0 && (
        <div className="border-t border-gray-700/50 bg-gray-900/50 p-3 max-h-48 overflow-y-auto">
          <ul className="space-y-0.5 font-mono text-xs">
            {job.logs.map((log, i) => (
              <li key={i} className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'}>
                <span className="text-gray-500 mr-2 select-none">
                  {new Date(log.time).toLocaleTimeString()}
                </span>
                {log.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobsPageClient() {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const { data: initialJobs, isLoading } = useJobs();

  useEffect(() => {
    if (initialJobs) setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    const unsubJob = subscribe('job-status', (msg) => {
      const updated = msg.payload;
      setJobs((prev) => {
        const next = [updated, ...prev.filter((j) => j.id !== updated.id)];
        return next.slice(0, 100);
      });
      queryClient.setQueryData(['jobs', updated.id], updated);
      queryClient.setQueryData(['jobs'], (prev) =>
        prev ? [updated, ...prev.filter((j) => j.id !== updated.id)] : [updated],
      );
    });

    const unsubList = subscribe('job-list', (msg) => {
      const list = msg.payload ?? [];
      setJobs(list);
      queryClient.setQueryData(['jobs'], list);
    });

    return () => { unsubJob(); unsubList(); };
  }, [subscribe, queryClient]);

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);
  const counts = FILTERS.slice(1).reduce((acc, f) => {
    acc[f] = jobs.filter((j) => j.status === f).length;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FiActivity size={24} className="text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-sm text-gray-400">{jobs.length} total · {counts.running ?? 0} running</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {f}
            {f !== 'all' && counts[f] > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {filter === 'all' ? 'No jobs have run yet.' : `No ${filter} jobs.`}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
