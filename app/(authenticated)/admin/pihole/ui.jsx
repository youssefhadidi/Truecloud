/** @format */

'use client';

import { FiCheck, FiX } from 'react-icons/fi';

/** Matches the card chrome used by the other admin pages. */
export function SectionCard({ title, action, children, footer }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow">
      {(title || action) && (
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700 flex items-center justify-between gap-3">
          <h2 className="text-base sm:text-lg font-semibold text-white">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4 sm:p-6 space-y-4">{children}</div>
      {footer && <div className="px-4 sm:px-6 py-3 border-t border-gray-700 flex justify-end gap-2">{footer}</div>}
    </div>
  );
}

export function StatusPill({ ok, okLabel, badLabel }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${
        ok ? 'bg-green-900 text-green-200' : 'bg-gray-700 text-gray-300'
      }`}
    >
      {ok ? <FiCheck size={12} /> : <FiX size={12} />}
      {ok ? okLabel : badLabel}
    </span>
  );
}

export function StatTile({ label, value, accent = 'text-white' }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

/**
 * A proportion rendered as a bar behind the row rather than a chart — no
 * charting dependency, and it reads the same way the other admin tables do.
 */
export function BarRow({ label, sublabel, value, max, formatValue }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className="relative px-3 py-2 rounded overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 bg-blue-600/20 rounded"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
      <div className="relative flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-200 truncate" title={label}>
            {label}
          </div>
          {sublabel && <div className="text-xs text-gray-500 truncate">{sublabel}</div>}
        </div>
        <div className="text-sm text-gray-300 tabular-nums shrink-0">
          {formatValue ? formatValue(value) : formatNumber(value)}
        </div>
      </div>
    </div>
  );
}

export function EmptyRow({ children }) {
  return <div className="px-3 py-6 text-center text-sm text-gray-500">{children}</div>;
}

export function formatNumber(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString();
}

export function formatPercent(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

/** Seconds → "4m 12s", for the blocking pause countdown. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Pull an error message out of an axios failure the way the other pages do. */
export function errorMessage(e, fallback) {
  return e?.response?.data?.error || e?.message || fallback;
}

export const inputClass =
  'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const buttonDanger =
  'inline-flex items-center justify-center gap-2 px-3 py-2 bg-red-900/60 text-red-200 text-sm rounded-lg hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
