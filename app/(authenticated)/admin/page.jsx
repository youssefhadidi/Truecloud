/** @format */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FiCpu, FiHardDrive, FiZap, FiActivity, FiUsers, FiServer,
  FiBox, FiPackage, FiSettings, FiArchive, FiTerminal, FiShield,
  FiRefreshCw, FiCheckCircle, FiAlertCircle, FiClock,
} from 'react-icons/fi';
import Card, { PageHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { useJobs } from '@/lib/api/jobs';

const STATS_PALETTE = [
  { color: 'var(--accent)' },
  { color: 'var(--success)' },
  { color: 'var(--warning)' },
  { color: 'var(--danger)' },
];

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        padding: '18px 20px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--r-md)',
          background: `color-mix(in oklab, ${color} 22%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={18} color={color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', marginBottom: 2, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function NavTile({ icon: Icon, label, href, router, color = 'var(--accent)' }) {
  return (
    <button
      onClick={() => router.push(href)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '14px 16px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 150ms',
        fontFamily: 'inherit',
        color: 'var(--text)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = '';
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 'var(--r-sm)',
          background: `color-mix(in oklab, ${color} 18%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={15} color={color} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
    </button>
  );
}

const STATUS_META = {
  running:   { Icon: FiActivity,    color: 'var(--accent)',  label: 'Running',  badgeColor: 'accent' },
  pending:   { Icon: FiClock,       color: 'var(--text-3)',  label: 'Pending',  badgeColor: 'accent' },
  completed: { Icon: FiCheckCircle, color: 'var(--success)', label: 'Done',     badgeColor: 'success' },
  failed:    { Icon: FiAlertCircle, color: 'var(--danger)',  label: 'Failed',   badgeColor: 'danger' },
  cancelled: { Icon: FiAlertCircle, color: 'var(--warning)', label: 'Cancelled',badgeColor: 'warning' },
};

function fmtBytes(n) {
  if (!n || !isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

export default function AdminPage() {
  const router = useRouter();
  const { data: jobs = [] } = useJobs();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/admin/system-info');
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setInfo(data);
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const cpu = info?.cpu;
  const memory = info?.memory;
  const disk = info?.disk;
  const runningJobs = jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  const recentJobs = jobs.slice(0, 8);

  const stats = [
    {
      icon: FiCpu,
      label: 'CPU Usage',
      value: cpu?.usage != null ? `${Math.round(cpu.usage)}%` : '—',
      sub: cpu?.cores ? `${cpu.cores} cores` : (loading ? 'loading…' : ''),
      color: STATS_PALETTE[0].color,
    },
    {
      icon: FiServer,
      label: 'RAM Used',
      value: memory?.used != null ? fmtBytes(memory.used) : '—',
      sub: memory?.total != null ? `of ${fmtBytes(memory.total)}` : '',
      color: STATS_PALETTE[1].color,
    },
    {
      icon: FiHardDrive,
      label: 'Disk Used',
      value: disk?.used != null ? fmtBytes(disk.used) : '—',
      sub: disk?.total != null ? `of ${fmtBytes(disk.total)}` : '',
      color: STATS_PALETTE[2].color,
    },
    {
      icon: FiZap,
      label: 'Active Jobs',
      value: String(runningJobs.length),
      sub: runningJobs.length === 1 ? 'running now' : 'running now',
      color: STATS_PALETTE[3].color,
    },
  ];

  const navTiles = [
    { icon: FiUsers,    label: 'User Accounts',   href: '/admin/accounts',          color: 'var(--accent)' },
    { icon: FiActivity, label: 'Background Jobs', href: '/admin/jobs',              color: 'var(--success)' },
    { icon: FiArchive,  label: 'Cache',           href: '/admin/cache',             color: 'var(--warning)' },
    { icon: FiTerminal, label: 'Logs',            href: '/admin/logs',              color: 'var(--text-2)' },
    { icon: FiActivity, label: 'Monitoring',      href: '/admin/monitoring',        color: 'var(--accent)' },
    { icon: FiServer,   label: 'ZFS Pools',       href: '/admin/zfs-pools',         color: 'var(--accent)' },
    { icon: FiPackage,  label: 'SMB Shares',      href: '/admin/smb-shares',        color: 'var(--success)' },
    { icon: FiBox,      label: 'Modules',         href: '/admin/modules',           color: 'var(--accent)' },
    { icon: FiBox,      label: 'Minecraft',       href: '/admin/minecraft',         color: 'var(--success)' },
    { icon: FiSettings, label: 'Components',      href: '/admin/components',        color: 'var(--text-2)' },
    { icon: FiSettings, label: 'Thumbnails',      href: '/admin/thumbnail-settings', color: 'var(--accent)' },
    { icon: FiSettings, label: 'Transcoding',     href: '/admin/transcoding-settings', color: 'var(--accent)' },
    { icon: FiRefreshCw, label: 'Updates',        href: '/admin/update-status',     color: 'var(--accent)' },
    { icon: FiShield,   label: 'Requirements',    href: '/admin/requirements',      color: 'var(--warning)' },
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <PageHeader title="Admin Panel" subtitle="System health and management" />

        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          {stats.map((s) => <StatCard key={s.label} {...s} />)}
        </div>

        {/* Background jobs */}
        <Card title="Background Jobs" subtitle={`${runningJobs.length} running`} padding={0} style={{ marginBottom: 24 }}>
          {recentJobs.length === 0 ? (
            <div style={{ padding: '24px 20px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
              No background jobs yet.
            </div>
          ) : (
            <div>
              {recentJobs.map((j, idx) => {
                const meta = STATUS_META[j.status] || STATUS_META.pending;
                const showProgress = j.status === 'running' && typeof j.progress === 'number';
                return (
                  <div
                    key={j.id}
                    style={{
                      padding: '14px 20px',
                      borderBottom: idx < recentJobs.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tc-truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {j.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, textTransform: 'capitalize' }}>
                        {String(j.type || '').replace(/-/g, ' ')}
                      </div>
                      {showProgress && (
                        <div
                          style={{
                            marginTop: 6,
                            height: 4,
                            background: 'var(--surface-2)',
                            borderRadius: 99,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.max(0, Math.min(100, j.progress))}%`,
                              background: 'var(--accent)',
                              borderRadius: 99,
                              transition: 'width 400ms ease',
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <Badge color={meta.badgeColor}>
                      {j.status === 'running' && typeof j.progress === 'number' ? `${j.progress}%` : meta.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Nav tiles */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.08em', marginBottom: 8 }}>
            ALL SECTIONS
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            {navTiles.map((t) => (
              <NavTile key={t.href} {...t} router={router} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
