/** @format */

'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FiUsers, FiPlus, FiEdit, FiTrash2, FiArrowLeft, FiX, FiRefreshCw } from 'react-icons/fi';
import axios from 'axios';
import LogViewer from '@/components/LogViewer';
import SystemRequirementsCheck from '@/components/SystemRequirementsCheck';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('accounts');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  // Debug session
  useEffect(() => {
    console.log('[AdminPage] Session status:', status);
    console.log('[AdminPage] Session data:', {
      email: session?.user?.email,
      role: session?.user?.role,
      id: session?.user?.id,
    });
  }, [status, session]);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.push('/files');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'admin') {
      fetchUsers();
    }
  }, [status, session]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/users');
      setUsers(response.data.users);
    } catch (error) {
      console.error('Error fetching users:', error);
      alert('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckUpdates = async () => {
    try {
      setCheckingUpdates(true);
      const response = await axios.get('/api/system/check-updates');
      setUpdateInfo(response.data);
      if (!response.data.hasUpdate) {
        alert(`You are up to date! (Version ${response.data.currentVersion})`);
      }
    } catch (error) {
      console.error('Error checking updates:', error);
      alert('Failed to check for updates');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleRunUpdate = async () => {
    if (!window.confirm('Are you sure you want to update? The server will restart automatically.')) {
      return;
    }
    try {
      await axios.post('/api/system/run-update');
      alert('Update started. The server will restart shortly...');
      setUpdateInfo(null);
    } catch (error) {
      console.error('Error running update:', error);
      alert('Failed to start update: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      // Ensure admins always have root access
      const userData = {
        ...formData,
        hasRootAccess: formData.role === 'admin' ? true : formData.hasRootAccess,
      };
      await axios.post('/api/users', userData);
      setShowForm(false);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      fetchUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      alert(error.response?.data?.error || 'Failed to create user');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      // Ensure admins always have root access
      const userData = {
        ...formData,
        id: editingUser.id,
        hasRootAccess: formData.role === 'admin' ? true : formData.hasRootAccess,
      };
      await axios.patch('/api/users', userData);
      setShowForm(false);
      setEditingUser(null);
      setFormData({ email: '', username: '', password: '', name: '', role: 'user', hasRootAccess: false });
      fetchUsers();
    } catch (error) {
      console.error('Error updating user:', error);
      alert(error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      await axios.delete(`/api/users?id=${userId}`);
      setDeletingUser(null);
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert(error.response?.data?.error || 'Failed to delete user');
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

  if (status === 'loading' || loading) {
    return (
      <div className="flex-1 bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (session?.user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="w-full h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => router.push('/files')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                <FiArrowLeft />
                Back to Files
              </button>
              <div className="flex items-center gap-2">
                <FiUsers className="text-2xl text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Tabs */}
          <div className="mb-6 border-b border-gray-200">
            <div className="flex gap-8">
              <button
                onClick={() => setActiveTab('accounts')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'accounts' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Accounts
              </button>
              <button
                onClick={() => setActiveTab('requirements')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'requirements' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                System Requirements
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Logs
              </button>
            </div>
          </div>

          {/* Accounts Tab */}
          {activeTab === 'accounts' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="bg-white rounded-lg shadow">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">Users ({users.length})</h2>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Root Access</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => (
                          <tr key={user.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap  font-medium text-gray-900">{user.username}</td>
                            <td className="px-6 py-4 whitespace-nowrap  text-gray-600">{user.email}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}
                              >
                                {user.role}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.hasRootAccess ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {user.hasRootAccess ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap ">
                              <div className="flex items-center gap-3">
                                <button onClick={() => openEditForm(user)} className="text-blue-600 hover:text-blue-900" title="Edit">
                                  <FiEdit size={18} />
                                </button>
                                {user.role !== 'admin' && (
                                  <button onClick={() => setDeletingUser(user)} className="text-red-600 hover:text-red-900" title="Delete">
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
                </div>
              </div>

              {/* User Form */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">{editingUser ? 'Edit User' : 'Create User'}</h2>
                    {showForm && (
                      <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">
                        <FiX size={20} />
                      </button>
                    )}
                  </div>

                  {!showForm ? (
                    <button onClick={openCreateForm} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      <FiPlus />
                      Add New User
                    </button>
                  ) : (
                    <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-4">
                      <div>
                        <label className="block  font-medium text-gray-700 mb-1">Username</label>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block  font-medium text-gray-700 mb-1">Email</label>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block  font-medium text-gray-700 mb-1">Name</label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block  font-medium text-gray-700 mb-1">Password {editingUser && '(leave blank to keep current)'}</label>
                        <input
                          type="password"
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          required={!editingUser}
                        />
                      </div>
                      <div>
                        <label className="block  font-medium text-gray-700 mb-1">Role</label>
                        <select
                          value={formData.role}
                          onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 font-medium text-gray-700">
                          <input
                            type="checkbox"
                            checked={formData.role === 'admin' ? true : formData.hasRootAccess}
                            onChange={(e) => setFormData({ ...formData, hasRootAccess: e.target.checked })}
                            disabled={formData.role === 'admin'}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                          />
                          Allow Root Access (Can access all files & folders)
                        </label>
                        <p className="mt-1 text-xs text-gray-500">
                          {formData.role === 'admin' ? 'Admins always have root access' : 'If unchecked, user can only access their personal folder'}
                        </p>
                      </div>
                      <div className="flex gap-2 pt-4">
                        <button type="button" onClick={closeForm} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                          Cancel
                        </button>
                        <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          {editingUser ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* System Settings */}
                <div className="bg-white rounded-lg shadow p-6 mt-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">System</h2>
                  <div className="space-y-3">
                    <button
                      onClick={handleCheckUpdates}
                      disabled={checkingUpdates}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-400"
                    >
                      <FiRefreshCw className={checkingUpdates ? 'animate-spin' : ''} />
                      {checkingUpdates ? 'Checking...' : 'Check for Updates'}
                    </button>
                    {updateInfo?.hasUpdate && (
                      <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
                        <p className="text-sm font-semibold text-blue-900 mb-2">
                          Update Available: {updateInfo.currentVersion} → {updateInfo.latestVersion}
                        </p>
                        <button onClick={handleRunUpdate} className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
                          Update Now
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* System Requirements Tab */}
          {activeTab === 'requirements' && (
            <div className="bg-white rounded-lg shadow p-6">
              <SystemRequirementsCheck />
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div>
              <LogViewer />
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Delete User</h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-gray-600">
                Are you sure you want to delete <strong>{deletingUser.username}</strong>?
              </p>
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                <p className="font-semibold mb-1">This action will:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Permanently delete this user account</li>
                  <li>Delete all files in their personal folder</li>
                  <li>Remove all associated permissions and sessions</li>
                </ul>
              </div>
              <p className="text-xs text-gray-500">This action cannot be undone.</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
              <button onClick={() => setDeletingUser(null)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleDeleteUser(deletingUser.id)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
