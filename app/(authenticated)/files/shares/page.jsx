/** @format */

'use client';

import { useState } from 'react';
import { FiShare2, FiCopy, FiTrash2, FiLock, FiUnlock, FiFolder, FiFile, FiCheck, FiEdit2 } from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useShares, useUpdateShare, useDeleteShare } from '@/lib/api/files';
import { useTranslation } from '@/components/LanguageProvider';

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SharesPage() {
  const router = useRouter();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();

  // React Query hooks
  const { data: shares = [], isLoading, error } = useShares();
  const updateMutation = useUpdateShare();
  const deleteMutation = useDeleteShare();

  // Local UI state
  const [copiedId, setCopiedId] = useState(null);
  const [editingShare, setEditingShare] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);

  const copyLink = async (share) => {
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/s/${share.token}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(share.id);
      addNotification('success', t('notify.linkCopied'));
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      addNotification('error', t('notify.copyLinkFailed'));
    }
  };

  const deleteShare = async (shareId) => {
    if (!confirm(t('share.confirmDelete'))) return;

    deleteMutation.mutate(shareId, {
      onSuccess: () => {
        addNotification('success', t('notify.shareDeleted'));
      },
      onError: () => {
        addNotification('error', t('notify.shareDeleteFailed'));
      },
    });
  };

  const updateShare = async () => {
    if (!editingShare) return;

    const body = {};
    if (removePassword) {
      body.removePassword = true;
    } else if (editPassword) {
      body.password = editPassword;
    }

    updateMutation.mutate(
      { shareId: editingShare.id, data: body },
      {
        onSuccess: () => {
          addNotification('success', t('notify.shareUpdated'));
          setEditingShare(null);
          setEditPassword('');
          setRemovePassword(false);
        },
        onError: () => {
          addNotification('error', t('notify.shareUpdateFailed'));
        },
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Page Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('sharesPage.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('sharesPage.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <FiShare2 className="text-indigo-500" size={24} />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">{shares.length}</span>
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
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {!isLoading && shares.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
            <FiShare2 className="mx-auto text-gray-400" size={48} />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">{t('sharesPage.noShares')}</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">{t('sharesPage.noSharesHint')}</p>
            <button onClick={() => router.push('/files/list')} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              {t('sharesPage.goToFiles')}
            </button>
          </div>
        ) : !isLoading && shares.length > 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400">
              <div className="col-span-4">{t('common.name')}</div>
              <div className="col-span-2">{t('sharesPage.colCreated')}</div>
              <div className="col-span-2">{t('sharesPage.colPassword')}</div>
              <div className="col-span-2">{t('sharesPage.colViews')}</div>
              <div className="col-span-2">{t('common.actions')}</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {shares.map((share) => (
                <div key={share.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  {/* Name */}
                  <div className="md:col-span-4 flex items-center gap-3">
                    {share.isDirectory ? <FiFolder className="text-blue-500 flex-shrink-0" size={20} /> : <FiFile className="text-gray-400 flex-shrink-0" size={20} />}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{share.fileName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{share.path}</p>
                    </div>
                  </div>

                  {/* Created */}
                  <div className="md:col-span-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">{t('sharesPage.createdLabel')}</span>
                    {formatDate(share.createdAt)}
                  </div>

                  {/* Password */}
                  <div className="md:col-span-2 flex items-center gap-2">
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">{t('sharesPage.passwordLabel')}</span>
                    {share.passwordHash ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                        <FiLock size={14} />
                        {t('sharesPage.protected')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <FiUnlock size={14} />
                        {t('common.none')}
                      </span>
                    )}
                  </div>

                  {/* Views */}
                  <div className="md:col-span-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">{t('sharesPage.viewsLabel')}</span>
                    {share.accessCount}
                  </div>

                  {/* Actions */}
                  <div className="md:col-span-2 flex items-center gap-2">
                    <button
                      onClick={() => copyLink(share)}
                      className={`p-2 rounded-lg transition-colors ${
                        copiedId === share.id
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                      title={t('common.copyLink')}
                    >
                      {copiedId === share.id ? <FiCheck size={18} /> : <FiCopy size={18} />}
                    </button>
                    <button
                      onClick={() => {
                        setEditingShare(share);
                        setEditPassword('');
                        setRemovePassword(false);
                      }}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg transition-colors"
                      title={t('common.edit')}
                    >
                      <FiEdit2 size={18} />
                    </button>
                    <button
                      onClick={() => deleteShare(share.id)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                      title={t('common.delete')}
                    >
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </div>
      </div>

      {/* Edit Modal */}
      {editingShare && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4" onClick={() => setEditingShare(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('sharesPage.editShare')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{editingShare.fileName}</p>

            <div className="space-y-4">
              {editingShare.passwordHash ? (
                <div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} className="rounded" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{t('sharesPage.removePassword')}</span>
                  </label>
                </div>
              ) : null}

              {!removePassword && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {editingShare.passwordHash ? t('sharesPage.changePassword') : t('sharesPage.addPassword')}
                  </label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder={t('sharesPage.enterNewPassword')}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingShare(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={updateShare}
                disabled={!removePassword && !editPassword}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
