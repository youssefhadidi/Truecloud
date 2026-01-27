/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiCopy, FiLock, FiCalendar, FiCheck, FiTrash2, FiX, FiLink, FiShare2 } from 'react-icons/fi';
import { useCreateShare, useDeleteShare, useFileShare } from '@/lib/api/files';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function ShareModal({ file, currentPath, onClose }) {
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [expiresIn, setExpiresIn] = useState('never');
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const { addNotification } = useNotifications();
  const createShareMutation = useCreateShare();
  const deleteShareMutation = useDeleteShare();
  const { data: existingShare, isLoading: checkingShare } = useFileShare(currentPath, file?.name);

  // Calculate expiration date
  const calculateExpiry = (option) => {
    if (option === 'never') return null;

    const now = new Date();
    switch (option) {
      case '1h':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case '24h':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  };

  // Set share URL if existing share
  useEffect(() => {
    if (existingShare) {
      const baseUrl = window.location.origin;
      setShareUrl(`${baseUrl}/s/${existingShare.token}`);
    }
  }, [existingShare]);

  const createShare = async () => {
    setLoading(true);
    try {
      const result = await createShareMutation.mutateAsync({
        path: currentPath,
        fileName: file.name,
        isDirectory: file.isDirectory,
        password: usePassword ? password : null,
        expiresAt: calculateExpiry(expiresIn),
      });

      setShareUrl(result.shareUrl);
      addNotification('success', 'Share created successfully');
    } catch (error) {
      addNotification('error', 'Failed to create share');
    } finally {
      setLoading(false);
    }
  };

  const deleteShare = async () => {
    if (!existingShare) return;

    if (!confirm('Are you sure you want to delete this share?')) return;

    try {
      await deleteShareMutation.mutateAsync(existingShare.id);
      setShareUrl(null);
      addNotification('success', 'Share deleted');
      onClose();
    } catch (error) {
      addNotification('error', 'Failed to delete share');
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      addNotification('success', 'Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      addNotification('error', 'Failed to copy link');
    }
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <FiShare2 className="text-green-600 dark:text-green-400" size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Share {file.isDirectory ? 'Folder' : 'File'}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[250px]">{file.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <FiX size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {checkingShare ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : shareUrl || existingShare ? (
            // Share exists - show link
            <>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Share Link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={copyLink}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                      copied
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {copied ? <FiCheck size={18} /> : <FiCopy size={18} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {existingShare && (
                <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>
                    {existingShare.passwordHash ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <FiLock size={14} />
                        Password protected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <FiLink size={14} />
                        Anyone with the link can access
                      </span>
                    )}
                  </span>
                  <span>{existingShare.accessCount} views</span>
                </div>
              )}
            </>
          ) : (
            // No share exists - show create form
            <>
              {/* Password protection */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={(e) => setUsePassword(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex items-center gap-2">
                    <FiLock size={16} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Password protection</span>
                  </div>
                </label>

                {usePassword && (
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                )}
              </div>

              {/* Expiration */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <FiCalendar size={16} className="text-gray-500" />
                  Link expiration
                </label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="never">Never expires</option>
                  <option value="1h">1 hour</option>
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          {existingShare ? (
            <>
              <button
                onClick={deleteShare}
                className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <FiTrash2 size={16} />
                Delete Share
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                Close
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={createShare}
                disabled={loading || (usePassword && !password)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Creating...
                  </>
                ) : (
                  <>
                    <FiShare2 size={16} />
                    Create Share
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
