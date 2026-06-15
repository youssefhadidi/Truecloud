/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX, FiRefreshCw } from 'react-icons/fi';
import DeleteConfirm from '@/components/DeleteConfirm';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '@/lib/api/users';
import { useCheckUpdates } from '@/lib/api/system';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

export default function AccountsPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    name: '',
    role: 'user',
    hasRootAccess: false,
  });

  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: users = [], isLoading: loadingUsers } = useUsers(true);
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const { data: updateInfo, refetch: checkForUpdates, isFetching: checkingUpdates } = useCheckUpdates(false);

  const handleCheckUpdates = async () => {
    try {
      localStorage.removeItem('update_dismissed_version');
      const result = await checkForUpdates();
      if (result.data && !result.data.hasUpdate) {
        addNotification('info', t('adminAccounts.upToDate', { version: result.data.currentVersion }));
      }
    } catch (error) {
      console.error('Error checking updates:', error);
      addNotification('error', t('adminAccounts.checkUpdatesFailed'));
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUserMutation.mutateAsync(formData);
      setShowForm(false);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      addNotification('success', t('adminAccounts.userCreated'));
    } catch (error) {
      console.error('Error creating user:', error);
      addNotification('error', error.response?.data?.error || t('adminAccounts.userCreateFailed'));
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      await updateUserMutation.mutateAsync({ ...formData, id: editingUser.id });
      setShowForm(false);
      setEditingUser(null);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      addNotification('success', t('adminAccounts.userUpdated'));
    } catch (error) {
      console.error('Error updating user:', error);
      addNotification('error', error.response?.data?.error || t('adminAccounts.userUpdateFailed'));
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      await deleteUserMutation.mutateAsync(userId);
      setDeletingUser(null);
      addNotification('success', t('adminAccounts.userDeleted'));
    } catch (error) {
      console.error('Error deleting user:', error);
      addNotification('error', error.response?.data?.error || t('adminAccounts.userDeleteFailed'));
    }
  };

  const openEditForm = (user) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      username: user.username,
      password: '',
      name: user.name || '',
      role: user.role,
      hasRootAccess: user.hasRootAccess || false,
    });
    setShowForm(true);
  };

  const openCreateForm = () => {
    setEditingUser(null);
    setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingUser(null);
    setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
  };

  if (loadingUsers) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">{t('adminAccounts.loading')}</div>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">{t('adminAccounts.title')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg shadow">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('adminAccounts.usersN', { count: users.length })}</h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700 border-b border-gray-600">
                  <tr>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminAccounts.colUsername')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminAccounts.colEmail')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminAccounts.colRole')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminAccounts.colRoot')}</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{t('adminAccounts.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-700">
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap font-medium text-white">{user.username}</td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap text-gray-300 text-sm">{user.email}</td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role === 'admin' ? 'bg-purple-900 text-purple-200' : 'bg-gray-700 text-gray-300'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.hasRootAccess ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                          {user.hasRootAccess ? t('adminAccounts.yes') : t('adminAccounts.no')}
                        </span>
                      </td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <button onClick={() => openEditForm(user)} className="text-blue-400 hover:text-blue-300" title={t('adminAccounts.edit')}>
                            <FiEdit size={18} />
                          </button>
                          {user.role !== 'admin' && (
                            <button onClick={() => setDeletingUser(user)} className="text-red-400 hover:text-red-300" title={t('adminAccounts.delete')}>
                              <FiTrash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-700">
              {users.map((user) => (
                <div key={user.id} className="p-4 hover:bg-gray-700">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">{user.username}</div>
                      <div className="text-sm text-gray-300 truncate">{user.email}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <button onClick={() => openEditForm(user)} className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded" title={t('adminAccounts.edit')}>
                        <FiEdit size={18} />
                      </button>
                      {user.role !== 'admin' && (
                        <button onClick={() => setDeletingUser(user)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded" title={t('adminAccounts.delete')}>
                          <FiTrash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role === 'admin' ? 'bg-purple-900 text-purple-200' : 'bg-gray-700 text-gray-300'}`}>
                      {user.role}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.hasRootAccess ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                      {user.hasRootAccess ? t('adminAccounts.rootAccess') : t('adminAccounts.noRootAccess')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* User Form */}
        <div className="lg:col-span-1">
          <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base sm:text-lg font-semibold text-white">{editingUser ? t('adminAccounts.editUser') : t('adminAccounts.createUser')}</h2>
              {showForm && (
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-300">
                  <FiX size={20} />
                </button>
              )}
            </div>

            {!showForm ? (
              <button onClick={openCreateForm} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm sm:text-base">
                <FiPlus />
                {t('adminAccounts.addNewUser')}
              </button>
            ) : (
              <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminAccounts.username')}</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminAccounts.email')}</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminAccounts.name')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminAccounts.password')} {editingUser && <span className="text-xs">{t('adminAccounts.passwordKeepHint')}</span>}</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required={!editingUser}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminAccounts.role')}</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
                  >
                    <option value="user">{t('adminAccounts.roleUser')}</option>
                    <option value="admin">{t('adminAccounts.roleAdmin')}</option>
                  </select>
                </div>
                <div>
                  <label className="flex items-start gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.hasRootAccess}
                      onChange={(e) => setFormData({ ...formData, hasRootAccess: e.target.checked })}
                      className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>{t('adminAccounts.allowRootAccess')}</span>
                  </label>
                  <p className="mt-1 text-xs text-gray-400 ml-6">{t('adminAccounts.rootAccessHint')}</p>
                </div>
                <div className="flex gap-2 pt-2 sm:pt-4">
                  <button type="button" onClick={closeForm} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
                    {t('adminAccounts.cancel')}
                  </button>
                  <button type="submit" className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    {editingUser ? t('adminAccounts.update') : t('adminAccounts.create')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* System Settings */}
          <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mt-4 sm:mt-6">
            <h2 className="text-base sm:text-lg font-semibold text-white mb-4">{t('adminAccounts.system')}</h2>
            <div className="space-y-3">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 text-sm sm:text-base bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-600"
              >
                <FiRefreshCw className={checkingUpdates ? 'animate-spin' : ''} size={18} />
                {checkingUpdates ? t('adminAccounts.checkingUpdates') : t('adminAccounts.checkUpdates')}
              </button>
              {updateInfo?.hasUpdate && (
                <div className="border border-blue-700 bg-blue-900/30 rounded-lg p-3">
                  <p className="text-xs sm:text-sm text-blue-300">
                    {t('adminAccounts.updateAvailable', { current: updateInfo.currentVersion, latest: updateInfo.latestVersion })}
                  </p>
                  <p className="text-xs text-blue-400 mt-1">{t('adminAccounts.useNotificationToUpdate')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {deletingUser && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50">
          <DeleteConfirm
            username={deletingUser.username}
            onCancel={() => setDeletingUser(null)}
            onConfirm={() => handleDeleteUser(deletingUser.id)}
            isLoading={deleteUserMutation.isPending}
          />
        </div>
      )}
    </>
  );
}
