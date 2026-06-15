/** @format */

'use client';

import { useMemo, useState, useDeferredValue } from 'react';
import { FiCopy, FiTrash2, FiLoader, FiAlertCircle } from 'react-icons/fi';
import { prettifyPath } from './userNames';
import { useTranslation } from '@/components/LanguageProvider';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Split a relative file path "shared/projects/foo.zip" into [dir, name].
function splitPath(rel) {
  const idx = rel.lastIndexOf('/');
  if (idx === -1) return ['', rel];
  return [rel.slice(0, idx), rel.slice(idx + 1)];
}

export default function DuplicatesList({ duplicates, usernames }) {
  const { t } = useTranslation();
  // Paths the admin has chosen to delete. Hidden from the view immediately;
  // we keep them in a Set rather than mutating `duplicates` because that prop
  // is replaced on every progress snapshot from the server.
  const [deleted, setDeleted] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [errors, setErrors] = useState(() => new Map()); // path -> message

  // Defer the snapshot ref so the sort/filter doesn't block other state
  // updates landing in the same WS tick.
  const deferredDuplicates = useDeferredValue(duplicates);

  // Filter out already-deleted paths and groups that have dropped below 2.
  // Sort by wasted space (size × (count − 1)) so the biggest cleanups float up.
  const visible = useMemo(() => {
    const out = [];
    for (const g of deferredDuplicates) {
      let kept = null;
      // Fast path: when nothing has been deleted yet we can keep the array
      // reference and skip the per-path filter allocation entirely. With a
      // long-running scan this is the common case.
      if (deleted.size === 0) {
        kept = g.paths;
      } else {
        kept = g.paths.filter((p) => !deleted.has(p));
        if (kept.length < 2) continue;
      }
      out.push({ name: g.name, size: g.size, paths: kept, wasted: g.size * (kept.length - 1) });
    }
    out.sort((a, b) => b.wasted - a.wasted);
    return out;
  }, [deferredDuplicates, deleted]);

  const totalWasted = visible.reduce((s, g) => s + g.wasted, 0);

  async function handleDelete(path) {
    if (!window.confirm(t('adminStorage.moveToTrashConfirm', { path }))) return;
    setBusy((prev) => new Set(prev).add(path));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    try {
      const [dir, name] = splitPath(path);
      const url = `/api/files?path=${encodeURIComponent(dir)}&id=${encodeURIComponent(name)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setDeleted((prev) => new Set(prev).add(path));
    } catch (err) {
      setErrors((prev) => new Map(prev).set(path, err?.message || t('adminStorage.deleteFailed')));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }

  if (duplicates.length === 0) {
    return (
      <div className="text-sm text-gray-500 px-4 py-6 text-center">
        {t('adminStorage.noDuplicates')}
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="text-sm text-gray-500 px-4 py-6 text-center">
        {t('adminStorage.allResolved')}
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 py-2 border-b border-gray-700/60 text-xs text-gray-400 tabular-nums flex items-center justify-between">
        <span>
          {visible.length === 1
            ? t('adminStorage.duplicateGroup', { count: visible.length.toLocaleString() })
            : t('adminStorage.duplicateGroups', { count: visible.length.toLocaleString() })}
        </span>
        <span>{t('adminStorage.reclaimable').split('{size}').flatMap((part, i) =>
          i === 0 ? [part] : [<span key={i} className="text-gray-300">{formatBytes(totalWasted)}</span>, part],
        )}</span>
      </div>
      <ul className="divide-y divide-gray-800/60 max-h-[60vh] overflow-y-auto">
        {visible.map((g) => (
          <DuplicateGroup
            key={`${g.name}|${g.size}`}
            group={g}
            busy={busy}
            errors={errors}
            onDelete={handleDelete}
            usernames={usernames}
          />
        ))}
      </ul>
    </div>
  );
}

function DuplicateGroup({ group, busy, errors, onDelete, usernames }) {
  const { t } = useTranslation();
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <FiCopy className="text-amber-400 shrink-0" size={14} />
          <span className="text-sm text-gray-200 truncate font-medium">{group.name}</span>
        </div>
        <div className="text-xs text-gray-400 tabular-nums shrink-0">
          {t('adminStorage.groupSummary', { count: group.paths.length, size: formatBytes(group.size), wasted: formatBytes(group.wasted) })}
        </div>
      </div>
      <ul className="space-y-1 ml-6">
        {group.paths.map((p) => {
          const isBusy = busy.has(p);
          const err = errors.get(p);
          const pretty = prettifyPath(p, usernames);
          return (
            <li key={p} className="flex items-center gap-3 text-xs">
              <span className="flex-1 min-w-0 truncate text-gray-400 font-mono" title={p}>{pretty}</span>
              {err && (
                <span className="flex items-center gap-1 text-red-400 shrink-0" title={err}>
                  <FiAlertCircle size={12} />
                  <span className="truncate max-w-[140px]">{err}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => onDelete(p)}
                disabled={isBusy}
                className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded text-gray-300 hover:bg-red-900/40 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label={t('adminStorage.deleteThisCopy')}
              >
                {isBusy ? <FiLoader size={12} className="animate-spin" /> : <FiTrash2 size={12} />}
                <span>{t('adminStorage.delete')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
