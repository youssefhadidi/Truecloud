/** @format */

'use client';

import { useState } from 'react';
import { FiSearch, FiDownload, FiUsers, FiAlertTriangle, FiArrowUp, FiArrowDown, FiCheckCircle } from 'react-icons/fi';
import { useTorrentSearch } from '@/lib/api/torrentSearch';
import { useStartDownload } from '@/lib/api/downloads';
import { SEARCH_CATEGORIES } from '@/lib/torrentSearchConstants';
import { useTranslation } from '@/components/LanguageProvider';

/** Sortable column header. Module scope so it isn't remounted on every render. */
function SortHeader({ field, activeField, order, onSort, children, className = '' }) {
  return (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400">
        {children}
        {activeField === field && (order === 'desc' ? <FiArrowDown size={12} /> : <FiArrowUp size={12} />)}
      </button>
    </th>
  );
}

/**
 * Search the public torrent index and hand a picked magnet to the existing
 * download pipeline (POST /api/files/torrent-download).
 *
 * Results are sorted server-side over the full 100-row result set, so the
 * sort controls re-query rather than reordering the current page.
 */
export default function TorrentSearchPanel({ currentPath = '', onDownloadStart }) {
  const { t } = useTranslation();

  const [queryInput, setQueryInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [category, setCategory] = useState(0);
  const [sort, setSort] = useState('seeders');
  const [order, setOrder] = useState('desc');
  const [downloadPath, setDownloadPath] = useState(currentPath);
  const [startedIds, setStartedIds] = useState([]);
  const [startError, setStartError] = useState('');

  const search = useTorrentSearch({ query: submitted, category, sort, order, enabled: !!submitted });
  const startDownloadMutation = useStartDownload();

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = queryInput.trim();
    if (trimmed.length < 2) return;
    setStartError('');
    setSubmitted(trimmed);
  };

  // Clicking the active column flips direction; a new column starts descending.
  const handleSort = (field) => {
    if (field === sort) {
      setOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(field);
      setOrder('desc');
    }
  };

  const handleDownload = async (result) => {
    if (!result.magnet) return;
    setStartError('');

    try {
      const formData = new FormData();
      formData.append('url', result.magnet);
      formData.append('downloadType', 'torrent');
      if (downloadPath) formData.append('path', downloadPath);

      const data = await startDownloadMutation.mutateAsync(formData);
      setStartedIds((prev) => [...prev, result.id]);
      onDownloadStart?.({ ...data, name: result.name });
    } catch (err) {
      setStartError(err.response?.data?.error || err.message || t('torrentSearch.startFailed'));
    }
  };

  const results = search.data?.results || [];
  const searchError = search.isError ? search.error?.response?.data?.error || search.error?.message : null;

  // Shared props for every sortable header cell.
  const sortProps = { activeField: sort, order, onSort: handleSort };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('torrentSearch.title')}</h2>

      {/* Search controls */}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder={t('torrentSearch.placeholder')}
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
        />
        <select
          value={category}
          onChange={(e) => setCategory(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white sm:w-56"
        >
          {SEARCH_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={queryInput.trim().length < 2 || search.isFetching}
          className="flex items-center justify-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          <FiSearch size={16} />
          {search.isFetching ? t('torrentSearch.searching') : t('torrentSearch.search')}
        </button>
      </form>

      {/* Destination folder for anything started from this panel */}
      <div className="mb-4">
        <label htmlFor="torrent-search-path" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {t('torrentSearch.savePath')}
        </label>
        <input
          id="torrent-search-path"
          type="text"
          value={downloadPath}
          onChange={(e) => setDownloadPath(e.target.value)}
          placeholder={t('torrentSearch.savePathPlaceholder')}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
        />
      </div>

      {startError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">{startError}</div>
      )}

      {searchError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
          {t('torrentSearch.searchFailed', { message: searchError })}
        </div>
      )}

      {/* The HTML mirror answered: fewer fields per row, 30 results instead of 100. */}
      {search.data?.degraded && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm flex items-start gap-2">
          <FiAlertTriangle className="mt-0.5 flex-shrink-0" size={14} />
          <span>{t('torrentSearch.degraded')}</span>
        </div>
      )}

      {/* Results */}
      {search.isFetching ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('torrentSearch.searching')}</p>
      ) : !submitted ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('torrentSearch.prompt')}</p>
      ) : results.length === 0 && !searchError ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('torrentSearch.noResults', { query: submitted })}</p>
      ) : results.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('torrentSearch.resultCount', { count: results.length })}</p>
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <SortHeader field="name" {...sortProps}>
                    {t('torrentSearch.colName')}
                  </SortHeader>
                  <SortHeader field="size" className="whitespace-nowrap" {...sortProps}>
                    {t('torrentSearch.colSize')}
                  </SortHeader>
                  <SortHeader field="seeders" className="whitespace-nowrap" {...sortProps}>
                    {t('torrentSearch.colSeeders')}
                  </SortHeader>
                  <SortHeader field="added" className="whitespace-nowrap hidden md:table-cell" {...sortProps}>
                    {t('torrentSearch.colAdded')}
                  </SortHeader>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {results.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2 max-w-md">
                      <p className="text-gray-900 dark:text-white truncate" title={r.name}>
                        {r.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                        <span>{r.categoryLabel}</span>
                        <span>·</span>
                        <span>{r.uploader}</span>
                        {(r.trust === 'vip' || r.trust === 'trusted') && (
                          <span
                            className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400"
                            title={t('torrentSearch.trustedTitle', { trust: r.trust })}
                          >
                            <FiCheckCircle size={11} />
                            {r.trust}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{r.sizeLabel}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          r.seeders === 0 ? 'text-red-500 dark:text-red-400' : r.seeders < 5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'
                        }`}
                        title={t('torrentSearch.peersTitle', { seeders: r.seeders, leechers: r.leechers })}
                      >
                        <FiUsers size={12} />
                        {r.seeders}
                        <span className="text-gray-400 dark:text-gray-500 font-normal">/{r.leechers}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {r.added ? new Date(r.added).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDownload(r)}
                        disabled={!r.magnet || startDownloadMutation.isPending || startedIds.includes(r.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium whitespace-nowrap"
                      >
                        <FiDownload size={12} />
                        {startedIds.includes(r.id) ? t('torrentSearch.added') : t('torrentSearch.download')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
