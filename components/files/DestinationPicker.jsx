/** @format */

'use client';

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FiFolder } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import { fetchFoldersHelper } from '@/lib/api/files';
import { useDownloadDestination, useDownloadsDispatch } from '@/lib/redux/hooks';
import { useTranslation } from '@/components/LanguageProvider';

const MoveModal = lazy(() => import('@/components/files/MoveModal'));

/**
 * Destination folder field for the downloads page.
 *
 * The value is the shared Redux `downloads.destinationPath`, so both panels on
 * the page show the same folder and the last one picked survives navigating
 * away. Browsing reuses MoveModal — the same folder browser the file list uses
 * for moves — while the text input stays editable, since a folder that does not
 * exist yet can only be entered by typing it.
 */
export default function DestinationPicker({
  id,
  label,
  hint,
  placeholder,
  currentPath = '',
  compact = false,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const destinationPath = useDownloadDestination();
  const { setDestinationPath } = useDownloadsDispatch();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Seed from the browsed folder only while nothing has been chosen yet.
  useEffect(() => {
    if (currentPath && !destinationPath) setDestinationPath(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Cached per folder, so re-opening the picker on a path already visited
  // renders from cache instead of refetching.
  const fetchFolders = useCallback(
    (path) =>
      queryClient.fetchQuery({
        queryKey: ['folders', path],
        queryFn: () => fetchFoldersHelper(path),
      }),
    [queryClient],
  );

  const sizeClasses = compact ? 'px-3 py-1.5 text-sm' : 'px-4 py-2';

  return (
    <>
      <div>
        <label
          htmlFor={id}
          className={
            compact
              ? 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'
              : 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          }
        >
          {label}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            value={destinationPath}
            onChange={(e) => setDestinationPath(e.target.value)}
            placeholder={placeholder}
            className={`flex-1 min-w-0 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${sizeClasses}`}
          />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${sizeClasses}`}
          >
            <FiFolder size={compact ? 14 : 16} />
            {t('downloads.browse')}
          </button>
        </div>
        {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>

      {pickerOpen && (
        <Suspense fallback={null}>
          <MoveModal
            open
            title={t('downloads.chooseDestination')}
            confirmLabel={t('downloads.saveHere')}
            initialPath={destinationPath}
            fetchFolders={fetchFolders}
            onConfirm={(path) => {
              setDestinationPath(path);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
