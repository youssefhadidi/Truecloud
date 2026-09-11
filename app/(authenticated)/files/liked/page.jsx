/** @format */

'use client';

import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FiHeart, FiFolder, FiFile, FiImage, FiVideo, FiMusic, FiFileText, FiBox,
  FiAlertCircle, FiDownload,
} from 'react-icons/fi';
import LazyImage from '@/components/files/LazyImage';
import { useLikedFiles, useUnlikeFile } from '@/lib/api/likes';
import { useShareOrDownload } from '@/hooks/useShareOrDownload';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';
import { getFileType, isViewableFile } from '@/lib/getFileType';
import { isImage, isVideo, isPdf } from '@/lib/clientFileUtils';

const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));

const TYPE_ICONS = { image: FiImage, video: FiVideo, audio: FiMusic, pdf: FiFileText, xlsx: FiFileText, '3d': FiBox };

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`;
}

/** Split a stored liked path into its containing folder and file name. */
function splitPath(fullPath) {
  const idx = fullPath.lastIndexOf('/');
  return idx === -1
    ? { dir: '', name: fullPath }
    : { dir: fullPath.slice(0, idx), name: fullPath.slice(idx + 1) };
}

export default function LikedPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data: liked = [], isLoading, error } = useLikedFiles();
  const unlikeMutation = useUnlikeFile();
  const { handleShareOrDownload } = useShareOrDownload();

  // The media viewer resolves every file against a single directory, so opening
  // an item scopes the viewer to the liked files living in that same folder.
  const [viewerState, setViewerState] = useState(null); // { dir, file }

  // Each liked row is decorated with the pieces the grid and the viewer need:
  // its folder, plus an `id` set to the file name, which is what the thumbnail
  // and stream routes key on.
  const items = useMemo(
    () =>
      liked.map((item) => {
        const { dir, name } = splitPath(item.path);
        return {
          ...item,
          dir,
          fileName: name,
          viewable: !item.missing && isViewableFile(name),
          hasThumbnail: !item.missing && (isImage(name) || isVideo(name) || isPdf(name)),
        };
      }),
    [liked],
  );

  const viewerFiles = useMemo(() => {
    if (!viewerState) return [];
    return items
      .filter((item) => item.dir === viewerState.dir && item.viewable)
      .map((item) => ({ id: item.fileName, name: item.fileName, isDirectory: false }));
  }, [items, viewerState]);

  const openViewer = useCallback((item) => {
    if (!item.viewable) return;
    setViewerState({ dir: item.dir, file: { id: item.fileName, name: item.fileName, isDirectory: false } });
  }, []);

  const navigateViewer = useCallback(
    (direction) => {
      setViewerState((prev) => {
        if (!prev) return prev;
        const index = viewerFiles.findIndex((f) => f.id === prev.file.id);
        if (index === -1) return prev;
        const next = direction === 'prev' ? index - 1 : index + 1;
        if (next < 0 || next >= viewerFiles.length) return prev;
        return { ...prev, file: viewerFiles[next] };
      });
    },
    [viewerFiles],
  );

  const unlike = useCallback(
    async (item) => {
      try {
        await unlikeMutation.mutateAsync({ id: item.id });
        addNotification('success', t('notify.unliked'));
      } catch {
        addNotification('error', t('notify.likeUpdateFailed'));
      }
    },
    [unlikeMutation, addNotification, t],
  );

  const openFolder = useCallback(
    (item) => {
      router.push(item.dir ? `/files/list?path=${encodeURIComponent(item.dir)}` : '/files/list');
    },
    [router],
  );

  const download = useCallback(
    (item) => {
      handleShareOrDownload(
        `/api/files/download/${encodeURIComponent(item.fileName)}?path=${encodeURIComponent(item.dir)}`,
        item.fileName,
      );
    },
    [handleShareOrDownload],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Page Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('likedPage.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('likedPage.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <FiHeart className="text-red-500" size={24} fill="currentColor" />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">{items.length}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
          )}

          {!isLoading && error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-600 dark:text-red-400">{t('likedPage.loadFailed')}</p>
            </div>
          )}

          {!isLoading && !error && items.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
              <FiHeart className="mx-auto text-gray-400" size={48} />
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">{t('likedPage.empty')}</h3>
              <p className="mt-2 text-gray-500 dark:text-gray-400">{t('likedPage.emptyHint')}</p>
              <button
                onClick={() => router.push('/files/list')}
                className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {t('sharesPage.goToFiles')}
              </button>
            </div>
          )}

          {!isLoading && items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((item) => {
                const TypeIcon = TYPE_ICONS[getFileType(item.fileName)] || FiFile;
                return (
                  <div
                    key={item.id}
                    className="group relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => (item.viewable ? openViewer(item) : openFolder(item))}
                      title={item.path}
                      className="relative block w-full aspect-square bg-gray-100 dark:bg-gray-700 overflow-hidden cursor-pointer"
                    >
                      {item.missing ? (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400">
                          <FiAlertCircle size={28} />
                          <span className="text-[11px] px-2 text-center">{t('likedPage.missing')}</span>
                        </span>
                      ) : item.hasThumbnail ? (
                        <LazyImage
                          isThumbnail
                          fileId={item.fileName}
                          filePath={item.dir}
                          alt={item.fileName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-gray-400">
                          <TypeIcon size={36} />
                        </span>
                      )}
                    </button>

                    {/* Hover actions */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {!item.missing && (
                        <button
                          onClick={() => download(item)}
                          title={t('common.download')}
                          className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                        >
                          <FiDownload size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => openFolder(item)}
                        title={t('likedPage.openFolder')}
                        className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                      >
                        <FiFolder size={14} />
                      </button>
                      <button
                        onClick={() => unlike(item)}
                        title={t('menu.unlike')}
                        className="p-1.5 rounded-full bg-black/60 text-red-400 hover:bg-black/80 transition-colors"
                      >
                        <FiHeart size={14} fill="currentColor" />
                      </button>
                    </div>

                    <div className="p-2 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={item.dir}>
                        {item.dir || t('likedPage.rootFolder')}
                        {item.size != null ? ` · ${formatFileSize(item.size)}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {viewerState && (
        <Suspense fallback={null}>
          <MediaViewer
            viewerFile={viewerState.file}
            viewableFiles={viewerFiles}
            currentPath={viewerState.dir}
            onClose={() => setViewerState(null)}
            onNavigate={navigateViewer}
            onSelectFile={(file) => setViewerState((prev) => (prev ? { ...prev, file } : prev))}
          />
        </Suspense>
      )}
    </div>
  );
}
