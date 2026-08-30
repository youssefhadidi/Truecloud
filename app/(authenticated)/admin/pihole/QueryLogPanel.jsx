/** @format */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiSearch } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { usePiholeQueries } from '@/lib/api/pihole';
import { SectionCard, EmptyRow, inputClass } from './ui';

const ROW_OPTIONS = [50, 100, 250, 500];

export default function QueryLogPanel() {
  const { t } = useTranslation();

  const [domain, setDomain] = useState('');
  const [client, setClient] = useState('');
  const [length, setLength] = useState(100);
  const [live, setLive] = useState(false);

  // Debounce the text filters so typing doesn't fire a request per keystroke.
  const debouncedDomain = useDebounced(domain, 350);
  const debouncedClient = useDebounced(client, 350);

  const filters = useMemo(
    () => ({
      length,
      ...(debouncedDomain ? { domain: debouncedDomain } : {}),
      ...(debouncedClient ? { client: debouncedClient } : {}),
    }),
    [length, debouncedDomain, debouncedClient],
  );

  const { data, isLoading, isFetching } = usePiholeQueries(filters, { live });
  const queries = data?.queries ?? [];

  return (
    <SectionCard
      title={t('adminPihole.tabQueryLog')}
      action={
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
          />
          <span className="flex items-center gap-1.5">
            {live && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />}
            {t('adminPihole.liveTail')}
          </span>
        </label>
      }
    >
      <p className="text-sm text-gray-400">{t('adminPihole.queryLogIntro')}</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative sm:flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={15} />
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t('adminPihole.filterDomain')}
            className={`${inputClass} pl-9`}
          />
        </div>
        <input
          type="text"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder={t('adminPihole.filterClient')}
          className={`${inputClass} sm:flex-1`}
        />
        <label className="flex items-center justify-between gap-2 shrink-0 sm:justify-start">
          <span className="text-xs text-gray-500">{t('adminPihole.rowCount')}</span>
          <select
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ROW_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm">{t('adminPihole.loading')}</div>
      ) : queries.length === 0 ? (
        <EmptyRow>{t('adminPihole.noQueries')}</EmptyRow>
      ) : (
        // The log holds up to 500 rows, so it scrolls in its own bounded region
        // rather than growing the page — the app shell is overflow:hidden, so an
        // unbounded table has nowhere to scroll.
        <div
          className={`max-h-[60vh] overflow-auto rounded-lg border border-gray-700/60 transition-opacity ${
            isFetching ? 'opacity-60' : ''
          }`}
        >
          {/* Seven columns need 760px, so below lg each query becomes a card:
              domain and verdict on top, the rest as wrapping metadata. */}
          <ul className="divide-y divide-gray-700/60 lg:hidden">
            {queries.map((q, index) => (
              <li key={q.id ?? `${q.time}-${q.domain}-${index}`} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-mono text-xs text-gray-200 break-all">{q.domain}</span>
                  <StatusBadge status={q.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  <span className="tabular-nums">{formatTime(q.time)}</span>
                  <span className="uppercase">{q.type}</span>
                  <span className="truncate max-w-[12rem]">{q.client?.name || q.client?.ip || '—'}</span>
                  <span className="tabular-nums">{formatReply(q.reply)}</span>
                  {q.upstream && <span className="truncate max-w-[12rem]">{q.upstream}</span>}
                </div>
              </li>
            ))}
          </ul>

          <table className="hidden lg:table w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-gray-800">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-700">
                <th className="px-3 py-2 font-semibold w-24">{t('adminPihole.colTime')}</th>
                <th className="px-3 py-2 font-semibold w-16">{t('adminPihole.colType')}</th>
                <th className="px-3 py-2 font-semibold">{t('adminPihole.colDomain')}</th>
                <th className="px-3 py-2 font-semibold w-40">{t('adminPihole.colClient')}</th>
                <th className="px-3 py-2 font-semibold w-32">{t('adminPihole.colStatus')}</th>
                <th className="px-3 py-2 font-semibold w-40">{t('adminPihole.colUpstream')}</th>
                <th className="px-3 py-2 font-semibold w-24">{t('adminPihole.colReply')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/60">
              {queries.map((q, index) => (
                <tr key={q.id ?? `${q.time}-${q.domain}-${index}`} className="text-gray-300">
                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {formatTime(q.time)}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{q.type}</td>
                  <td className="px-3 py-2 max-w-sm">
                    <span className="block truncate font-mono text-xs" title={q.domain}>
                      {q.domain}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 max-w-[10rem]">
                    <span className="block truncate" title={q.client?.ip}>
                      {q.client?.name || q.client?.ip || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-3 py-2 text-gray-500 max-w-[10rem]">
                    <span className="block truncate" title={q.upstream || ''}>
                      {q.upstream || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {formatReply(q.reply)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * FTL status strings are upper-snake, e.g. GRAVITY, FORWARDED, CACHE,
 * REGEX, DENYLIST, SPECIAL_DOMAIN. Anything containing a block reason is
 * shown as blocked; the rest fall into allowed/cached.
 */
function StatusBadge({ status }) {
  const value = String(status || '').toUpperCase();
  const blocked = /GRAVITY|DENYLIST|BLACKLIST|REGEX|BLOCKED|REFUSED|EXTERNAL_BLOCKED|SPECIAL_DOMAIN/.test(value);
  const cached = value.startsWith('CACHE');

  const tone = blocked
    ? 'bg-red-900/60 text-red-200'
    : cached
      ? 'bg-blue-900/50 text-blue-200'
      : 'bg-gray-700 text-gray-300';

  return (
    <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-full ${tone}`} title={value}>
      {value.replace(/_/g, ' ').toLowerCase() || '—'}
    </span>
  );
}

// FTL reports query time as a unix timestamp in seconds (fractional).
function formatTime(time) {
  const ms = Number(time) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleTimeString();
}

function formatReply(reply) {
  const ms = Number(reply?.time);
  if (!Number.isFinite(ms) || ms < 0) return reply?.type || '—';
  return `${ms.toFixed(1)} ms`;
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
