/** @format */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  FiZap, FiCheckCircle, FiXCircle, FiLoader, FiClock, FiAlertCircle,
} from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useJobs } from '@/lib/api/jobs';
import { useQueryClient } from '@tanstack/react-query';
import IconBtn from '@/components/ui/IconBtn';
import Badge from '@/components/ui/Badge';

const STATUS_META = {
  running:   { Icon: FiLoader,      color: 'var(--accent)',  spin: true,  label: 'Running' },
  pending:   { Icon: FiClock,       color: 'var(--text-3)',  spin: false, label: 'Pending' },
  completed: { Icon: FiCheckCircle, color: 'var(--success)', spin: false, label: 'Done' },
  failed:    { Icon: FiXCircle,     color: 'var(--danger)',  spin: false, label: 'Failed' },
  cancelled: { Icon: FiAlertCircle, color: 'var(--warning)', spin: false, label: 'Cancelled' },
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

  useEffect(() => {
    if (initialJobs) setJobs(initialJobs);
  }, [initialJobs]);

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

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
  const preview = jobs.slice(0, 6);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconBtn
        icon={FiZap}
        title="Background jobs"
        active={open}
        badge={runningCount || null}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          className="tc-anim-scale"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 7000,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-xl)',
            width: 320,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Background Jobs</span>
            {runningCount > 0 && <Badge color="accent">{runningCount} running</Badge>}
          </div>

          {preview.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
              No jobs yet
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {preview.map((job) => {
                const meta = STATUS_META[job.status] ?? STATUS_META.pending;
                const Icon = meta.Icon;
                const showProgress = job.status === 'running' && typeof job.progress === 'number';
                return (
                  <div
                    key={job.id}
                    style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                        gap: 8,
                      }}
                    >
                      <span
                        className="tc-truncate"
                        style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}
                      >
                        {job.name}
                      </span>
                      <Icon
                        size={13}
                        color={meta.color}
                        style={meta.spin ? { animation: 'tc-spin 800ms linear infinite' } : undefined}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, textTransform: 'capitalize' }}>
                      {String(job.type || '').replace(/-/g, ' ') || meta.label}
                      {job.startTime && ` · ${formatDuration(job.startTime, job.endTime)}`}
                    </div>
                    {showProgress && (
                      <div
                        style={{
                          height: 4,
                          background: 'var(--surface-2)',
                          borderRadius: 99,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.max(0, Math.min(100, job.progress))}%`,
                            background: 'var(--accent)',
                            borderRadius: 99,
                            transition: 'width 400ms ease',
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => { setOpen(false); router.push('/admin/jobs'); }}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid var(--border)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent)',
              cursor: 'pointer',
              textAlign: 'center',
              fontFamily: 'inherit',
            }}
          >
            View all jobs →
          </button>
        </div>
      )}
    </div>
  );
}
