/** @format */

'use client';

import { CATEGORY_ORDER } from '@/lib/storageCategories';
import { useMemo } from 'react';
import { useTranslation } from '@/components/LanguageProvider';

const LABEL_KEYS = {
  video: 'adminStorage.catVideo',
  image: 'adminStorage.catImage',
  audio: 'adminStorage.catAudio',
  pdf: 'adminStorage.catPdf',
  xlsx: 'adminStorage.catXlsx',
  documents: 'adminStorage.catDocuments',
  '3d': 'adminStorage.cat3d',
  archives: 'adminStorage.catArchives',
  code: 'adminStorage.catCode',
  other: 'adminStorage.catOther',
};

const COLORS = {
  video: 'bg-purple-500',
  image: 'bg-pink-500',
  audio: 'bg-emerald-500',
  pdf: 'bg-red-500',
  xlsx: 'bg-green-600',
  documents: 'bg-blue-500',
  '3d': 'bg-cyan-500',
  archives: 'bg-yellow-500',
  code: 'bg-indigo-500',
  other: 'bg-gray-500',
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function CategoryBreakdown({ categories, totalBytes }) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const out = CATEGORY_ORDER.map((name) => {
      const c = categories[name] || { bytes: 0, count: 0 };
      return { name, bytes: c.bytes, count: c.count };
    }).filter((r) => r.bytes > 0 || r.count > 0);
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
  }, [categories]);

  if (rows.length === 0) {
    return <div className="text-sm text-gray-500">{t('adminStorage.noFilesScanned')}</div>;
  }

  const max = Math.max(...rows.map((r) => r.bytes), 1);
  const denom = totalBytes || max;

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pct = denom > 0 ? (r.bytes / denom) * 100 : 0;
        return (
          <li key={r.name}>
            <div className="flex items-baseline justify-between text-xs text-gray-300 mb-1">
              <span className="font-medium">{t(LABEL_KEYS[r.name])}</span>
              <span className="tabular-nums text-gray-400">
                {formatBytes(r.bytes)} <span className="text-gray-500">· {r.count.toLocaleString()}</span>
              </span>
            </div>
            <div className="h-2 rounded bg-gray-800 overflow-hidden">
              <div className={`h-full ${COLORS[r.name]}`} style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
