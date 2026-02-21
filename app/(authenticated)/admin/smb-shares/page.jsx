/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX, FiRefreshCw } from 'react-icons/fi';
import { useSmbShares, useCreateSmbShare, useUpdateSmbShare, useDeleteSmbShare } from '@/lib/api/smbShares';
import { useUsers } from '@/lib/api/users';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function SmbSharesPage() {
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
      addNotification('success', 'SMB share created successfully');
    } catch (error) {
      console.error('Error creating share:', error);
      addNotification('error', error.response?.data?.error || 'Failed to create SMB share');
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
      addNotification('success', 'SMB share updated successfully');
    } catch (error) {
      console.error('Error updating share:', error);
      addNotification('error', error.response?.data?.error || 'Failed to update SMB share');
    }
  };

  const handleDeleteShare = async (shareId) => {
    try {
      await deleteShareMutation.mutateAsync(shareId);
      setDeletingShare(null);
      addNotification('success', 'SMB share deleted successfully');
    } catch (error) {
      console.error('Error deleting share:', error);
      addNotification('error', error.response?.data?.error || 'Failed to delete SMB share');
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
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">SMB Shares</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg shadow">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">Shares ({shares.length})</h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700 border-b border-gray-600">
                  <tr>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Name</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Path</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Read-Only</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Guest OK</th>
                    <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {shares.map((share) => (
                    <tr key={share.id} className="hover:bg-gray-700">
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap font-medium text-white">{share.name}</td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap text-gray-300 text-sm">{share.path || '/'}</td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.readOnly ? 'bg-blue-900 text-blue-200' : 'bg-gray-700 text-gray-300'}`}>
                          {share.readOnly ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.guestOk ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                          {share.guestOk ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 lg:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <button onClick={() => openEditForm(share)} className="text-blue-400 hover:text-blue-300" title="Edit">
                            <FiEdit size={18} />
                          </button>
                          <button onClick={() => setDeletingShare(share)} className="text-red-400 hover:text-red-300" title="Delete">
                            <FiTrash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-700">
              {shares.map((share) => (
                <div key={share.id} className="p-4 hover:bg-gray-700">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">{share.name}</div>
                      <div className="text-sm text-gray-300 truncate">{share.path || '/'}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <button onClick={() => openEditForm(share)} className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded" title="Edit">
                        <FiEdit size={18} />
                      </button>
                      <button onClick={() => setDeletingShare(share)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded" title="Delete">
                        <FiTrash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.readOnly ? 'bg-blue-900 text-blue-200' : 'bg-gray-700 text-gray-300'}`}>
                      {share.readOnly ? 'Read-Only' : 'Read-Write'}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${share.guestOk ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                      {share.guestOk ? 'Guest OK' : 'No Guest'}
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
              <h2 className="text-base sm:text-lg font-semibold text-white">{editingShare ? 'Edit Share' : 'Create Share'}</h2>
              {showForm && (
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-300">
                  <FiX size={20} />
                </button>
              )}
            </div>

            {!showForm ? (
              <button onClick={openCreateForm} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm sm:text-base">
                <FiPlus />
                Add New Share
              </button>
            ) : (
              <form onSubmit={editingShare ? handleUpdateShare : handleCreateShare} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Share Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder="e.g., documents"
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">No spaces or brackets allowed</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Path</label>
                  <input
                    type="text"
                    value={formData.path}
                    onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder="e.g., user_abc or leave empty for root"
                  />
                  <p className="text-xs text-gray-400 mt-1">Relative to upload directory</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Comment</label>
                  <input
                    type="text"
                    value={formData.comment}
                    onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder="e.g., Company documents"
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
                    <span>Read-Only</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.browsable}
                      onChange={(e) => setFormData({ ...formData, browsable: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>Browsable</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.guestOk}
                      onChange={(e) => setFormData({ ...formData, guestOk: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>Allow Guest Access</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Valid Users</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto bg-gray-700 rounded-lg p-2">
                    {loadingUsers ? (
                      <p className="text-xs text-gray-400">Loading users...</p>
                    ) : users.length === 0 ? (
                      <p className="text-xs text-gray-400">No users available</p>
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
                  <p className="text-xs text-gray-400 mt-1">Leave empty to allow all users</p>
                </div>

                <div className="flex gap-2 pt-2 sm:pt-4">
                  <button type="button" onClick={closeForm} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
                    Cancel
                  </button>
                  <button type="submit" className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    {editingShare ? 'Update' : 'Create'}
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
              <h3 className="text-lg font-semibold text-white">Delete Share</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-gray-300">
                Are you sure you want to delete the share <strong>{deletingShare.name}</strong>?
              </p>
              <p className="text-sm text-gray-400 mt-2">This will remove the share from Samba configuration, but will not delete the files.</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex gap-3">
              <button
                onClick={() => setDeletingShare(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteShare(deletingShare.id)}
                disabled={deleteShareMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600"
              >
                {deleteShareMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
