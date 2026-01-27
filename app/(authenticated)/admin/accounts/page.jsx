/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX, FiRefreshCw } from 'react-icons/fi';
import DeleteConfirm from '@/components/DeleteConfirm';
import Confirm from '@/components/Confirm';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '@/lib/api/users';
import { useCheckUpdates, useRunUpdate } from '@/lib/api/system';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function AccountsPage() {
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
  const [showConfirmUpdate, setShowConfirmUpdate] = useState(false);

  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: users = [], isLoading: loadingUsers } = useUsers(true);
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const { data: updateInfo, refetch: checkForUpdates, isFetching: checkingUpdates } = useCheckUpdates(false);
  const runUpdateMutation = useRunUpdate();

  const handleCheckUpdates = async () => {
    try {
      const result = await checkForUpdates();
      if (result.data && !result.data.hasUpdate) {
        addNotification('info', `You are up to date! (Version ${result.data.currentVersion})`);
      }
    } catch (error) {
      console.error('Error checking updates:', error);
      addNotification('error', 'Failed to check for updates');
    }
  };

  const confirmRunUpdate = async () => {
    try {
      await runUpdateMutation.mutateAsync();
      addNotification('success', 'Update started. The server will restart shortly...');
    } catch (error) {
      console.error('Error running update:', error);
      addNotification('error', 'Failed to start update: ' + (error.response?.data?.error || error.message));
    } finally {
      setShowConfirmUpdate(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUserMutation.mutateAsync(formData);
      setShowForm(false);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      addNotification('success', 'User created successfully');
    } catch (error) {
      console.error('Error creating user:', error);
      addNotification('error', error.response?.data?.error || 'Failed to create user');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      await updateUserMutation.mutateAsync({ ...formData, id: editingUser.id });
      setShowForm(false);
      setEditingUser(null);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      addNotification('success', 'User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      addNotification('error', error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      await deleteUserMutation.mutateAsync(userId);
      setDeletingUser(null);
      addNotification('success', 'User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      addNotification('error', error.response?.data?.error || 'Failed to delete user');
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
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">User Accounts</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg shadow">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">Users ({users.length})</h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700 border-b border-gray-600">
                  <tr>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Username</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Email</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Role</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Root</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
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
                          {user.hasRootAccess ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <button onClick={() => openEditForm(user)} className="text-blue-400 hover:text-blue-300" title="Edit">
                            <FiEdit size={18} />
                          </button>
                          {user.role !== 'admin' && (
                            <button onClick={() => setDeletingUser(user)} className="text-red-400 hover:text-red-300" title="Delete">
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
                      <button onClick={() => openEditForm(user)} className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded" title="Edit">
                        <FiEdit size={18} />
                      </button>
                      {user.role !== 'admin' && (
                        <button onClick={() => setDeletingUser(user)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded" title="Delete">
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
                      {user.hasRootAccess ? 'Root Access' : 'No Root Access'}
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
              <h2 className="text-base sm:text-lg font-semibold text-white">{editingUser ? 'Edit User' : 'Create User'}</h2>
              {showForm && (
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-300">
                  <FiX size={20} />
                </button>
              )}
            </div>

            {!showForm ? (
              <button onClick={openCreateForm} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm sm:text-base">
                <FiPlus />
                Add New User
              </button>
            ) : (
              <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Password {editingUser && <span className="text-xs">(leave blank to keep current)</span>}</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    required={!editingUser}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
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
                    <span>Allow Root Access (Can access all files & folders)</span>
                  </label>
                  <p className="mt-1 text-xs text-gray-400 ml-6">If unchecked, user can only access their personal folder</p>
                </div>
                <div className="flex gap-2 pt-2 sm:pt-4">
                  <button type="button" onClick={closeForm} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
                    Cancel
                  </button>
                  <button type="submit" className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    {editingUser ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* System Settings */}
          <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6 mt-4 sm:mt-6">
            <h2 className="text-base sm:text-lg font-semibold text-white mb-4">System</h2>
            <div className="space-y-3">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 text-sm sm:text-base bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-600"
              >
                <FiRefreshCw className={checkingUpdates ? 'animate-spin' : ''} size={18} />
                {checkingUpdates ? 'Checking...' : 'Check for Updates'}
              </button>
              {updateInfo?.hasUpdate && (
                <div className="border border-blue-700 bg-blue-900/30 rounded-lg p-3">
                  <p className="text-xs sm:text-sm font-semibold text-blue-300 mb-2">
                    Update Available: {updateInfo.currentVersion} → {updateInfo.latestVersion}
                  </p>
                  {!showConfirmUpdate ? (
                    <button onClick={() => setShowConfirmUpdate(true)} className="w-full px-3 py-2 bg-blue-600 text-white text-xs sm:text-sm font-medium rounded hover:bg-blue-700">
                      Update Now
                    </button>
                  ) : (
                    <Confirm
                      message="Are you sure you want to update? The server will restart automatically."
                      onCancel={() => setShowConfirmUpdate(false)}
                      onConfirm={confirmRunUpdate}
                      isLoading={runUpdateMutation.isPending}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
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
