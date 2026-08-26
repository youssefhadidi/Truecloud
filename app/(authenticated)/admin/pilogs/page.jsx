/** @format */

'use client';

/**
 * DNS category breakdown per client IP.
 *
 * Not present in the admin navigation (app/(authenticated)/admin/layout.jsx
 * builds that from an explicit list), so it is reachable only by typing the
 * path. The real gate is requireAdmin on /api/admin/pilogs — see the note
 * there. Strings are plain English rather than i18n keys, since this is an
 * internal diagnostic page rather than shipped product surface.
 */

import { useMemo, useState } from 'react';
import { FiRefreshCw, FiChevronRight, FiAlertTriangle } from 'react-icons/fi';
import { usePiholeCategoryReport } from '@/lib/api/pilogs';
import { CATEGORIES, NOISE_CATEGORIES, categoryMeta } from '@/lib/dnsCategories';
import { SectionCard, StatTile, BarRow, EmptyRow, formatNumber, buttonSecondary } from '../pihole/ui';

const WINDOWS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: '90 days', hours: 24 * 90 },
];

/** Categories worth a colour — the rest read as neutral counts. */
const TONE_CLASS = {
  red: 'bg-red-900/60 text-red-200',
  amber: 'bg-amber-900/60 text-amber-200',
  blue: 'bg-blue-900/50 text-blue-200',
  violet: 'bg-violet-900/50 text-violet-200',
  teal: 'bg-teal-900/50 text-teal-200',
  gray: 'bg-gray-700 text-gray-300',
};

const SIGNAL_CATEGORIES = CATEGORIES.filter((c) => !NOISE_CATEGORIES.has(c.key));

export default function PiLogsPage() {
  const [hours, setHours] = useState(24);
  const [showNoise, setShowNoise] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const { data, isLoading, isFetching, refetch, error } = usePiholeCategoryReport({ hours });

  const visibleCategories = showNoise ? CATEGORIES : SIGNAL_CATEGORIES;

  const totalsMax = useMemo(() => {
    if (!data?.totals) return 0;
    return Math.max(...visibleCategories.map((c) => data.totals[c.key] || 0), 0);
  }, [data, visibleCategories]);

  const flagged = useMemo(() => {
    if (!data?.totals) return [];
    return ['adult', 'gambling', 'piracy', 'vpn'].filter((k) => (data.totals[k] || 0) > 0);
  }, [data]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">DNS categories</h1>
          <p className="text-sm text-gray-500 mt-0.5">Per-client breakdown from the Pi-hole query database</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={buttonSecondary}>
            <FiRefreshCw className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error ? (
        <SectionCard title="Report unavailable">
          <div className="flex gap-3 text-sm">
            <FiAlertTriangle className="text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-gray-200">{error?.response?.data?.error || error.message}</div>
              {error?.response?.data?.hint && (
                <div className="text-gray-500">{error.response.data.hint}</div>
              )}
            </div>
          </div>
        </SectionCard>
      ) : isLoading ? (
        <div className="text-gray-400">Building report…</div>
      ) : (
        <div className={`space-y-4 sm:space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatTile label="Lookups" value={formatNumber(data.totalHits)} />
            <StatTile label="Blocked" value={formatNumber(data.totalBlocked)} />
            <StatTile label="Devices" value={formatNumber(data.clientCount)} />
            <StatTile
              label="Flagged categories"
              value={flagged.length ? String(flagged.length) : 'None'}
              accent={flagged.length ? 'text-amber-300' : 'text-green-300'}
            />
          </div>

          {/* The blocking decision this page exists to answer. */}
          <SectionCard title="Network totals">
            {flagged.length === 0 ? (
              <div className="text-sm text-green-300">
                No adult, gambling, piracy, or VPN lookups in this window. Nothing here argues for adding those
                blocklists.
              </div>
            ) : (
              <div className="text-sm text-gray-300">
                Present in this window:{' '}
                {flagged.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ', '}
                    <span className="text-amber-300">{categoryMeta(k).label.toLowerCase()}</span>{' '}
                    <span className="text-gray-500 tabular-nums">({formatNumber(data.totals[k])})</span>
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-0.5">
              {visibleCategories.map((c) => (
                <BarRow key={c.key} label={c.label} value={data.totals[c.key] || 0} max={totalsMax} />
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showNoise}
                onChange={(e) => setShowNoise(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              Include CDN, ads, telemetry and uncategorised
            </label>
          </SectionCard>

          <SectionCard
            title="By device"
            action={<span className="text-xs text-gray-500 tabular-nums">{formatNumber(data.distinctPairs)} distinct names</span>}
          >
            {data.clients.length === 0 ? (
              <EmptyRow>No queries in this window.</EmptyRow>
            ) : (
              <div className="rounded-lg border border-gray-700/60 divide-y divide-gray-700/60">
                {data.clients.map((client) => (
                  <ClientRow
                    key={client.ip}
                    client={client}
                    categories={visibleCategories}
                    open={expanded === client.ip}
                    onToggle={() => setExpanded(expanded === client.ip ? null : client.ip)}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <p className="text-xs text-gray-600 leading-relaxed">
            A DNS lookup is not proof a page was opened — prefetch, embedded third-party content, and ad networks all
            generate them, and a device using encrypted DNS or a VPN does not appear here at all. Treat a category as a
            signal to look closer, not as a finding. Nothing on this page is stored: it is aggregated from the query
            history Pi-hole already keeps and discarded when you navigate away.
            {data.overlay?.loaded && (
              <> Overlay lists loaded from {data.overlay.dir} ({formatNumber(data.overlay.size)} domains).</>
            )}
          </p>
        </div>
      )}
    </>
  );
}

function ClientRow({ client, categories, open, onToggle }) {
  const present = categories.filter((c) => (client.categories[c.key] || 0) > 0);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-gray-700/30 transition-colors"
      >
        <FiChevronRight
          className={`text-gray-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          size={16}
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm text-gray-200">{client.ip}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {present.length === 0 ? (
              <span className="text-xs text-gray-600">no categorised traffic</span>
            ) : (
              present.map((c) => (
                <span
                  key={c.key}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ${TONE_CLASS[c.tone]}`}
                >
                  {c.label}
                  <span className="tabular-nums opacity-70">{formatNumber(client.categories[c.key])}</span>
                </span>
              ))
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm text-gray-300 tabular-nums">{formatNumber(client.hits)}</div>
          <div className="text-xs text-gray-600">{formatRelative(client.lastSeen)}</div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-10 space-y-3">
          {present.length === 0 ? (
            <EmptyRow>Nothing to show.</EmptyRow>
          ) : (
            present.map((c) => (
              <div key={c.key}>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">{c.label}</div>
                <div className="space-y-0.5">
                  {(client.topDomains[c.key] || []).map((d) => (
                    <div key={d.domain} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-mono text-xs text-gray-400 truncate" title={d.domain}>
                        {d.domain}
                      </span>
                      <span className="text-gray-500 tabular-nums shrink-0">
                        {formatNumber(d.hits)}
                        {d.blocked > 0 && <span className="text-red-400"> · {formatNumber(d.blocked)} blocked</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(unixSeconds) {
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
