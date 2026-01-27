/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiShare2, FiCopy, FiTrash2, FiLock, FiUnlock, FiFolder, FiFile, FiArrowLeft, FiCheck, FiEdit2 } from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/contexts/NotificationsContext';

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
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [editingShare, setEditingShare] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const router = useRouter();
  const { addNotification } = useNotifications();

  useEffect(() => {
    fetchShares();
  }, []);

  const fetchShares = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/shares');
      const data = await res.json();

      if (res.ok) {
        setShares(data.shares || []);
      } else {
        setError(data.error || 'Failed to load shares');
      }
    } catch (e) {
      setError('Failed to load shares');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async (share) => {
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/s/${share.token}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(share.id);
      addNotification('success', 'Link copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      addNotification('error', 'Failed to copy link');
    }
  };

  const deleteShare = async (shareId) => {
    if (!confirm('Are you sure you want to delete this share?')) return;

    try {
      const res = await fetch(`/api/shares/${shareId}`, { method: 'DELETE' });

      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== shareId));
        addNotification('success', 'Share deleted');
      } else {
        addNotification('error', 'Failed to delete share');
      }
    } catch (e) {
      addNotification('error', 'Failed to delete share');
    }
  };

  const updateShare = async () => {
    if (!editingShare) return;

    try {
      const body = {};
      if (removePassword) {
        body.removePassword = true;
      } else if (editPassword) {
        body.password = editPassword;
      }

      const res = await fetch(`/api/shares/${editingShare.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setShares((prev) => prev.map((s) => (s.id === editingShare.id ? data.share : s)));
        addNotification('success', 'Share updated');
        setEditingShare(null);
        setEditPassword('');
        setRemovePassword(false);
      } else {
        addNotification('error', 'Failed to update share');
      }
    } catch (e) {
      addNotification('error', 'Failed to update share');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/files')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
              <FiArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Shares</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Manage your shared files and folders</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FiShare2 className="text-indigo-500" size={24} />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">{shares.length}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {shares.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
            <FiShare2 className="mx-auto text-gray-400" size={48} />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No shares yet</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">Share files or folders from the file browser to see them here.</p>
            <button onClick={() => router.push('/files')} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              Go to Files
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Created</div>
              <div className="col-span-2">Password</div>
              <div className="col-span-2">Views</div>
              <div className="col-span-2">Actions</div>
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
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">Created:</span>
                    {formatDate(share.createdAt)}
                  </div>

                  {/* Password */}
                  <div className="md:col-span-2 flex items-center gap-2">
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">Password:</span>
                    {share.passwordHash ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                        <FiLock size={14} />
                        Protected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <FiUnlock size={14} />
                        None
                      </span>
                    )}
                  </div>

                  {/* Views */}
                  <div className="md:col-span-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="md:hidden font-medium text-gray-700 dark:text-gray-300 mr-2">Views:</span>
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
                      title="Copy link"
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
                      title="Edit"
                    >
                      <FiEdit2 size={18} />
                    </button>
                    <button
                      onClick={() => deleteShare(share.id)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingShare && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4" onClick={() => setEditingShare(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Edit Share</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{editingShare.fileName}</p>

            <div className="space-y-4">
              {editingShare.passwordHash ? (
                <div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} className="rounded" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Remove password protection</span>
                  </label>
                </div>
              ) : null}

              {!removePassword && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {editingShare.passwordHash ? 'Change password' : 'Add password'}
                  </label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Enter new password"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingShare(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={updateShare}
                disabled={!removePassword && !editPassword}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
