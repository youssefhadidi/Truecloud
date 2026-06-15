/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX } from 'react-icons/fi';
import { useSmbShares, useCreateSmbShare, useUpdateSmbShare, useDeleteSmbShare } from '@/lib/api/smbShares';
import { useUsers } from '@/lib/api/users';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

export default function SmbSharesPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editingShare, setEditingShare] = useState(null);
  const [deletingShare, setDeletingShare] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    comment: '',
    readOnly: false,
    browsable: true,
    guestOk: false,
    validUsers: [],
  });

  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: shares = [], isLoading: loadingShares } = useSmbShares(true);
  const { data: users = [], isLoading: loadingUsers } = useUsers(true);
  const createShareMutation = useCreateSmbShare();
  const updateShareMutation = useUpdateSmbShare();
  const deleteShareMutation = useDeleteSmbShare();

  const handleCreateShare = async (e) => {
    e.preventDefault();
    try {
      await createShareMutation.mutateAsync(formData);
      setShowForm(false);
      setFormData({
        name: '',
        path: '',
        comment: '',
        readOnly: false,
        browsable: true,
        guestOk: false,
        validUsers: [],
      });
      addNotification('success', t('adminSmb.shareCreated'));
    } catch (error) {
      console.error('Error creating share:', error);
      addNotification('error', error.response?.data?.error || t('adminSmb.shareCreateFailed'));
    }
  };

  const handleUpdateShare = async (e) => {
    e.preventDefault();
    try {
      await updateShareMutation.mutateAsync({ ...formData, id: editingShare.id });
      setShowForm(false);
      setEditingShare(null);
      setFormData({
        name: '',
        path: '',
        comment: '',
        readOnly: false,
        browsable: true,
        guestOk: false,
        validUsers: [],
      });
      addNotification('success', t('adminSmb.shareUpdated'));
    } catch (error) {
      console.error('Error updating share:', error);
      addNotification('error', error.response?.data?.error || t('adminSmb.shareUpdateFailed'));
    }
  };

  const handleDeleteShare = async (shareId) => {
    try {
      await deleteShareMutation.mutateAsync(shareId);
      setDeletingShare(null);
      addNotification('success', t('adminSmb.shareDeleted'));
    } catch (error) {
      console.error('Error deleting share:', error);
      addNotification('error', error.response?.data?.error || t('adminSmb.shareDeleteFailed'));
    }
  };

  const openEditForm = (share) => {
    setEditingShare(share);
    setFormData({
      name: share.name,
      path: share.path,
      comment: share.comment || '',
      readOnly: share.readOnly || false,
      browsable: share.browsable !== false,
      guestOk: share.guestOk || false,
      validUsers: JSON.parse(share.validUsers || '[]'),
    });
    setShowForm(true);
  };

  const openCreateForm = () => {
    setEditingShare(null);
    setFormData({
      name: '',
      path: '',
      comment: '',
      readOnly: false,
      browsable: true,
      guestOk: false,
      validUsers: [],
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingShare(null);
    setFormData({
      name: '',
      path: '',
      comment: '',
      readOnly: false,
      browsable: true,
      guestOk: false,
      validUsers: [],
    });
  };

  const toggleValidUser = (username) => {
    setFormData((prev) => {
      const currentUsers = [...prev.validUsers];
      const index = currentUsers.indexOf(username);
      if (index > -1) {
        currentUsers.splice(index, 1);
      } else {
        currentUsers.push(username);
      }
      return { ...prev, validUsers: currentUsers };
    });
  };

  if (loadingShares) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">{t('adminSmb.loading')}</div>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">{t('adminSmb.title')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg shadow">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('adminSmb.sharesN', { count: shares.length })}</h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700 border-b border-gray-600">
                  <tr>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminSmb.colName')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminSmb.colPath')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminSmb.colReadOnly')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminSmb.colGuestOk')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminSmb.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {shares.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">
                        {t('adminSmb.noShares')}
                      </td>
                    </tr>
                  ) : (
                    shares.map((share) => (
                      <tr key={share.id} className="hover:bg-gray-700">
                        <td className="px-4 lg:px-6 py-4 whitespace-nowrap font-medium text-white">{share.name}</td>
                        <td className="px-4 lg:px-6 py-4 whitespace-nowrap text-gray-300 text-sm">{share.path || '/'}</td>
                        <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.readOnly ? 'bg-blue-900 text-blue-200' : 'bg-gray-700 text-gray-300'}`}>
                            {share.readOnly ? t('adminSmb.yes') : t('adminSmb.no')}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.guestOk ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                            {share.guestOk ? t('adminSmb.yes') : t('adminSmb.no')}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <button onClick={() => openEditForm(share)} className="text-blue-400 hover:text-blue-300" title={t('adminSmb.edit')}>
                              <FiEdit size={18} />
                            </button>
                            <button onClick={() => setDeletingShare(share)} className="text-red-400 hover:text-red-300" title={t('adminSmb.delete')}>
                              <FiTrash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-700">
              {shares.length === 0 && (
                <div className="p-6 text-center text-gray-400 text-sm">
                  {t('adminSmb.noShares')}
                </div>
              )}
              {shares.map((share) => (
                <div key={share.id} className="p-4 hover:bg-gray-700">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">{share.name}</div>
                      <div className="text-sm text-gray-300 truncate">{share.path || '/'}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <button onClick={() => openEditForm(share)} className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded" title={t('adminSmb.edit')}>
                        <FiEdit size={18} />
                      </button>
                      <button onClick={() => setDeletingShare(share)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded" title={t('adminSmb.delete')}>
                        <FiTrash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.readOnly ? 'bg-blue-900 text-blue-200' : 'bg-gray-700 text-gray-300'}`}>
                      {share.readOnly ? t('adminSmb.readOnly') : t('adminSmb.readWrite')}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.guestOk ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                      {share.guestOk ? t('adminSmb.guestOk') : t('adminSmb.noGuest')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Share Form */}
        <div className="lg:col-span-1">
          <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base sm:text-lg font-semibold text-white">{editingShare ? t('adminSmb.editShare') : t('adminSmb.createShare')}</h2>
              {showForm && (
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-300">
                  <FiX size={20} />
                </button>
              )}
            </div>

            {!showForm ? (
              <button onClick={openCreateForm} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm sm:text-base">
                <FiPlus />
                {t('adminSmb.addNewShare')}
              </button>
            ) : (
              <form onSubmit={editingShare ? handleUpdateShare : handleCreateShare} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminSmb.shareName')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder={t('adminSmb.shareNamePlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">{t('adminSmb.shareNameHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminSmb.path')}</label>
                  <input
                    type="text"
                    value={formData.path}
                    onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder={t('adminSmb.pathPlaceholder')}
                  />
                  <p className="text-xs text-gray-400 mt-1">{t('adminSmb.pathHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminSmb.comment')}</label>
                  <input
                    type="text"
                    value={formData.comment}
                    onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder={t('adminSmb.commentPlaceholder')}
                  />
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.readOnly}
                      onChange={(e) => setFormData({ ...formData, readOnly: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>{t('adminSmb.readOnly')}</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.browsable}
                      onChange={(e) => setFormData({ ...formData, browsable: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>{t('adminSmb.browsable')}</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.guestOk}
                      onChange={(e) => setFormData({ ...formData, guestOk: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>{t('adminSmb.allowGuest')}</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('adminSmb.validUsers')}</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto bg-gray-700 rounded-lg p-2">
                    {loadingUsers ? (
                      <p className="text-xs text-gray-400">{t('adminSmb.loadingUsers')}</p>
                    ) : users.length === 0 ? (
                      <p className="text-xs text-gray-400">{t('adminSmb.noUsers')}</p>
                    ) : (
                      users.map((user) => (
                        <label key={user.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.validUsers.includes(user.username)}
                            onChange={() => toggleValidUser(user.username)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                          />
                          <span>{user.username}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{t('adminSmb.validUsersHint')}</p>
                </div>

                <div className="flex gap-2 pt-2 sm:pt-4">
                  <button type="button" onClick={closeForm} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
                    {t('adminSmb.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={createShareMutation.isPending || updateShareMutation.isPending}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600"
                  >
                    {createShareMutation.isPending || updateShareMutation.isPending
                      ? t('adminSmb.saving')
                      : editingShare
                        ? t('adminSmb.update')
                        : t('adminSmb.create')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {deletingShare && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-sm w-full">
            <div className="px-6 py-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">{t('adminSmb.deleteShare')}</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-gray-300">
                {t('adminSmb.deleteConfirmPrefix')}<strong>{deletingShare.name}</strong>{t('adminSmb.deleteConfirmSuffix')}
              </p>
              <p className="text-sm text-gray-400 mt-2">{t('adminSmb.deleteNote')}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex gap-3">
              <button
                onClick={() => setDeletingShare(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
              >
                {t('adminSmb.cancel')}
              </button>
              <button
                onClick={() => handleDeleteShare(deletingShare.id)}
                disabled={deleteShareMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600"
              >
                {deleteShareMutation.isPending ? t('adminSmb.deleting') : t('adminSmb.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
